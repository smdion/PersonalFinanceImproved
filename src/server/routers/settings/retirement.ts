import { z } from "zod/v4";
import { eq, asc } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  brokerageProcedure,
  getSessionUserLabel,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  DEFAULT_TAX_RATE_TRADITIONAL,
  DEFAULT_TAX_RATE_ROTH,
  DEFAULT_TAX_RATE_BROKERAGE,
} from "@/lib/constants";
import { withdrawalStrategyEnum } from "@/lib/config/withdrawal-strategies";
import { zDecimal } from "./_shared";

// --- Zod schemas ---

const retirementSettingsInput = z.object({
  personId: z.number().int(),
  retirementAge: z.number().int().min(18).max(100),
  endAge: z.number().int().min(30).max(120),
  returnAfterRetirement: zDecimal,
  annualInflation: zDecimal,
  postRetirementInflation: zDecimal.nullable().optional(),
  salaryAnnualIncrease: zDecimal,
  salaryCap: zDecimal.nullable().optional(),
  raisesDuringRetirement: z.boolean().default(false),
  withdrawalRate: zDecimal.optional(),
  taxMultiplier: zDecimal.optional(),
  grossUpForTaxes: z.boolean().optional(),
  rothBracketTarget: zDecimal.nullable().optional(),
  enableRothConversions: z.boolean().optional(),
  rothConversionTarget: zDecimal.nullable().optional(),
  withdrawalStrategy: z.enum(withdrawalStrategyEnum()).optional(),
  gkUpperGuardrail: zDecimal.optional(),
  gkLowerGuardrail: zDecimal.optional(),
  gkIncreasePct: zDecimal.optional(),
  gkDecreasePct: zDecimal.optional(),
  gkSkipInflationAfterLoss: z.boolean().optional(),
  sdAnnualDeclineRate: zDecimal.optional(),
  cpWithdrawalPercent: zDecimal.optional(),
  cpFloorPercent: zDecimal.optional(),
  enWithdrawalPercent: zDecimal.optional(),
  enRollingYears: z.number().int().min(3).max(20).optional(),
  enFloorPercent: zDecimal.optional(),
  vdBasePercent: zDecimal.optional(),
  vdCeilingPercent: zDecimal.optional(),
  vdFloorPercent: zDecimal.optional(),
  rmdMultiplier: zDecimal.optional(),
  enableIrmaaAwareness: z.boolean().optional(),
  enableAcaAwareness: z.boolean().optional(),
  householdSize: z.number().int().min(1).max(8).optional(),
  socialSecurityMonthly: zDecimal.optional(),
  ssStartAge: z.number().int().min(62).max(70).optional(),
  filingStatus: z.enum(["MFJ", "Single", "HOH"]).nullable().optional(),
});

const retirementScenarioInput = z.object({
  name: z.string().min(1),
  withdrawalRate: zDecimal,
  targetAnnualIncome: zDecimal,
  annualInflation: zDecimal,
  distributionTaxRateTraditional: zDecimal.default(
    String(DEFAULT_TAX_RATE_TRADITIONAL),
  ),
  distributionTaxRateRoth: zDecimal.default(String(DEFAULT_TAX_RATE_ROTH)),
  distributionTaxRateHsa: zDecimal.default("0"),
  distributionTaxRateBrokerage: zDecimal.default(
    String(DEFAULT_TAX_RATE_BROKERAGE),
  ),
  isLtBrokerageEnabled: z.boolean().default(true),
  ltBrokerageAnnualContribution: zDecimal.default("0"),
  isSelected: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});

const returnRateInput = z.object({
  age: z.number().int(),
  rateOfReturn: zDecimal,
});

// --- Procedures ---

export const retirementProcedures = {
  retirementSettings: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSettings)
        .orderBy(asc(schema.retirementSettings.personId)),
    ),
    upsert: adminProcedure
      .input(retirementSettingsInput)
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.retirementSettings)
          .where(eq(schema.retirementSettings.personId, input.personId));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.retirementSettings)
            .set(input)
            .where(eq(schema.retirementSettings.personId, input.personId))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.retirementSettings)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
  }),

  retirementSalaryOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementSalaryOverrides)
        .orderBy(asc(schema.retirementSalaryOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int(),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementSalaryOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int(),
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementSalaryOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementSalaryOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementSalaryOverrides)
          .where(eq(schema.retirementSalaryOverrides.id, input.id)),
      ),
  }),

  retirementBudgetOverrides: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementBudgetOverrides)
        .orderBy(asc(schema.retirementBudgetOverrides.projectionYear)),
    ),
    create: adminProcedure
      .input(
        z.object({
          personId: z.number().int(),
          projectionYear: z.number().int(),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementBudgetOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: z.number().int(),
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementBudgetOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementBudgetOverrides.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementBudgetOverrides)
          .where(eq(schema.retirementBudgetOverrides.id, input.id)),
      ),
  }),

  projectionOverrides: createTRPCRouter({
    get: protectedProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.db
          .select()
          .from(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          )
          .then((r) => (r[0]?.overrides as Record<string, unknown>[]) ?? []),
      ),
    save: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
          overrides: z.array(z.record(z.string(), z.unknown())),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.projectionOverrides)
          .values({
            overrideType: input.overrideType,
            overrides: input.overrides,
            createdBy: getSessionUserLabel(ctx.session),
          })
          .onConflictDoUpdate({
            target: schema.projectionOverrides.overrideType,
            set: {
              overrides: input.overrides,
              updatedBy: getSessionUserLabel(ctx.session),
            },
          })
          .returning()
          .then((r) => r[0]),
      ),
    clear: brokerageProcedure
      .input(
        z.object({
          overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.projectionOverrides)
          .where(
            eq(schema.projectionOverrides.overrideType, input.overrideType),
          ),
      ),
  }),

  retirementScenarios: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.retirementScenarios)
        .orderBy(asc(schema.retirementScenarios.id)),
    ),
    create: adminProcedure
      .input(retirementScenarioInput)
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementScenarios)
          .values(input)
          .returning()
          .then((r) => r[0]),
      ),
    update: adminProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(retirementScenarioInput.shape),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementScenarios)
          .set(data)
          .where(eq(schema.retirementScenarios.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.retirementScenarios)
          .where(eq(schema.retirementScenarios.id, input.id)),
      ),
  }),

  returnRates: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.returnRateTable)
        .orderBy(asc(schema.returnRateTable.age)),
    ),
    upsert: adminProcedure
      .input(returnRateInput)
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select()
          .from(schema.returnRateTable)
          .where(eq(schema.returnRateTable.age, input.age));
        if (existing.length > 0) {
          return ctx.db
            .update(schema.returnRateTable)
            .set(input)
            .where(eq(schema.returnRateTable.age, input.age))
            .returning()
            .then((r) => r[0]);
        }
        return ctx.db
          .insert(schema.returnRateTable)
          .values(input)
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.returnRateTable)
          .where(eq(schema.returnRateTable.id, input.id)),
      ),
  }),
};
