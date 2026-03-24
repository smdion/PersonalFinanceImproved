import { z } from "zod/v4";
import { eq, asc, and } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import {
  accountCategoryEnum,
  getAccountTypeConfig,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  TAX_TREATMENT_VALUES,
  MATCH_TAX_TREATMENT_VALUES,
  CONTRIBUTION_METHOD_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  HSA_COVERAGE_TYPE_VALUES,
  ACCOUNT_OWNERSHIP_VALUES,
} from "@/lib/config/enum-values";
import { zDecimal } from "./_shared";

// --- Zod schemas ---

const personInput = z.object({
  name: z.string().min(1),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isPrimaryUser: z.boolean().default(false),
});

const jobInput = z
  .object({
    personId: z.number().int(),
    employerName: z.string().trim().min(1),
    title: z.string().trim().nullable().optional(),
    annualSalary: zDecimal,
    payPeriod: z.enum(["weekly", "biweekly", "semimonthly", "monthly"]),
    payWeek: z.enum(["even", "odd", "na"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    anchorPayDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    bonusPercent: zDecimal.default("0"),
    bonusMultiplier: zDecimal.default("1.0"),
    monthsInBonusYear: z.number().int().default(12),
    include401kInBonus: z.boolean().default(false),
    includeBonusInContributions: z.boolean().default(false),
    bonusOverride: zDecimal.nullable().optional(),
    bonusMonth: z.number().int().min(1).max(12).nullable().optional(),
    bonusDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    w4FilingStatus: z.enum(["MFJ", "Single", "HOH"]),
    w4Box2cChecked: z.boolean().default(false),
    additionalFedWithholding: zDecimal.default("0"),
    budgetPeriodsPerMonth: zDecimal.nullable().optional(),
  })
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

const salaryChangeInput = z.object({
  jobId: z.number().int(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newSalary: zDecimal,
  raisePercent: zDecimal.nullable().optional(),
  notes: z.string().nullable().optional(),
});

const contributionAccountInput = z.object({
  jobId: z.number().int().nullable().optional(),
  personId: z.number().int(),
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
  taxTreatment: z.enum(TAX_TREATMENT_VALUES),
  contributionMethod: z.enum(CONTRIBUTION_METHOD_VALUES),
  contributionValue: zDecimal,
  employerMatchType: z.enum(EMPLOYER_MATCH_TYPE_VALUES),
  employerMatchValue: zDecimal.nullable().optional(),
  employerMaxMatchPct: zDecimal.nullable().optional(),
  employerMatchTaxTreatment: z
    .enum(MATCH_TAX_TREATMENT_VALUES)
    .default("pre_tax"),
  hsaCoverageType: z.enum(HSA_COVERAGE_TYPE_VALUES).nullable().optional(),
  autoMaximize: z.boolean().default(false),
  isActive: z.boolean().default(true),
  ownership: z.enum(ACCOUNT_OWNERSHIP_VALUES).default("individual"),
  performanceAccountId: z.number().int().nullable().optional(),
  targetAnnual: zDecimal.nullable().optional(),
  allocationPriority: z.number().int().default(0),
  notes: z.string().nullable().optional(),
  isPayrollDeducted: z.boolean().nullable().optional(),
  priorYearContribAmount: zDecimal.optional(),
});

const deductionInput = z.object({
  jobId: z.number().int(),
  deductionName: z.string().trim().min(1),
  amountPerPeriod: zDecimal,
  isPretax: z.boolean(),
  ficaExempt: z.boolean().default(false),
});

// --- Procedures ---

export const paycheckProcedures = {
  people: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
    ),
    create: adminProcedure.input(personInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.people)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(personInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.people)
          .set(data)
          .where(eq(schema.people.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.delete(schema.people).where(eq(schema.people.id, input.id)),
      ),
  }),

  jobs: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.jobs)
        .orderBy(asc(schema.jobs.personId), asc(schema.jobs.startDate)),
    ),
    create: adminProcedure.input(jobInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.jobs)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(jobInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.jobs)
          .set(data)
          .where(eq(schema.jobs.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.delete(schema.jobs).where(eq(schema.jobs.id, input.id)),
      ),
  }),

  salaryChanges: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.salaryChanges)
        .orderBy(
          asc(schema.salaryChanges.jobId),
          asc(schema.salaryChanges.effectiveDate),
        ),
    ),
    create: adminProcedure.input(salaryChangeInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.salaryChanges)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(salaryChangeInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.salaryChanges)
          .set(data)
          .where(eq(schema.salaryChanges.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.salaryChanges)
          .where(eq(schema.salaryChanges.id, input.id)),
      ),
  }),

  contributionAccounts: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.contributionAccounts)
        .orderBy(asc(schema.contributionAccounts.personId)),
    ),
    create: adminProcedure
      .input(contributionAccountInput)
      .mutation(async ({ ctx, input }) => {
        // When linked to a master account, sync parentCategory from its parentCategory
        let resolvedParentCategory = input.parentCategory;
        if (input.performanceAccountId) {
          const [master] = await ctx.db
            .select({
              parentCategory: schema.performanceAccounts.parentCategory,
            })
            .from(schema.performanceAccounts)
            .where(
              eq(schema.performanceAccounts.id, input.performanceAccountId),
            );
          if (master)
            resolvedParentCategory = master.parentCategory as
              | "Retirement"
              | "Portfolio";
        }
        const [created] = await ctx.db
          .insert(schema.contributionAccounts)
          .values({ ...input, parentCategory: resolvedParentCategory })
          .returning();

        // Auto-create inactive stubs for other supported tax treatments
        // so the UI always shows the full account structure
        if (input.performanceAccountId) {
          const cfg = getAccountTypeConfig(
            input.accountType as AccountCategory,
          );
          const existingTreatments = await ctx.db
            .select({ taxTreatment: schema.contributionAccounts.taxTreatment })
            .from(schema.contributionAccounts)
            .where(
              and(
                eq(
                  schema.contributionAccounts.performanceAccountId,
                  input.performanceAccountId,
                ),
              ),
            );
          const existingSet = new Set<string>(
            existingTreatments.map((r) => r.taxTreatment),
          );
          const missing = cfg.supportedTaxTreatments.filter(
            (t) => !existingSet.has(t),
          );

          if (missing.length > 0) {
            await ctx.db.insert(schema.contributionAccounts).values(
              missing.map((taxTreatment) => ({
                personId: input.personId,
                jobId: input.jobId ?? null,
                accountType: input.accountType,
                parentCategory: resolvedParentCategory,
                taxTreatment: taxTreatment as
                  | "pre_tax"
                  | "tax_free"
                  | "after_tax"
                  | "hsa",
                contributionMethod: "percent_of_salary" as const,
                contributionValue: "0",
                employerMatchType: "none" as const,
                isActive: false,
                ownership: input.ownership ?? ("individual" as const),
                performanceAccountId: input.performanceAccountId,
              })),
            );
          }
        }

        return created;
      }),
    update: adminProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(contributionAccountInput.shape),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        // Validate priorYearContribAmount only allowed for eligible account types
        if (
          data.priorYearContribAmount !== undefined &&
          Number(data.priorYearContribAmount) > 0
        ) {
          const cfg = getAccountTypeConfig(data.accountType as AccountCategory);
          if (!cfg.supportsPriorYearContrib) {
            throw new Error(
              `Prior-year contributions are not supported for ${data.accountType} accounts`,
            );
          }
        }

        // Resolve the performanceAccountId — use incoming value, or look up existing row
        const perfAccountId =
          data.performanceAccountId !== undefined
            ? data.performanceAccountId
            : await ctx.db
                .select({
                  performanceAccountId:
                    schema.contributionAccounts.performanceAccountId,
                })
                .from(schema.contributionAccounts)
                .where(eq(schema.contributionAccounts.id, id))
                .then((r) => r[0]?.performanceAccountId ?? null);

        // When linked to a master account, sync parentCategory from its parentCategory
        const resolvedData = { ...data };
        if (perfAccountId) {
          const [master] = await ctx.db
            .select({
              parentCategory: schema.performanceAccounts.parentCategory,
            })
            .from(schema.performanceAccounts)
            .where(eq(schema.performanceAccounts.id, perfAccountId));
          if (master)
            resolvedData.parentCategory = master.parentCategory as
              | "Retirement"
              | "Portfolio";
        }

        return ctx.db
          .update(schema.contributionAccounts)
          .set(resolvedData)
          .where(eq(schema.contributionAccounts.id, id))
          .returning()
          .then((r) => r[0]);
      }),
    setPriorYearAmount: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          priorYearContribAmount: zDecimal,
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Look up the account type to validate eligibility
        const [row] = await ctx.db
          .select({ accountType: schema.contributionAccounts.accountType })
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.id, input.id));
        if (!row) throw new Error("Contribution account not found");
        const cfg = getAccountTypeConfig(row.accountType as AccountCategory);
        if (!cfg.supportsPriorYearContrib) {
          throw new Error(
            `Prior-year contributions are not supported for ${row.accountType} accounts`,
          );
        }
        const priorYear = new Date().getFullYear() - 1;
        return ctx.db
          .update(schema.contributionAccounts)
          .set({
            priorYearContribAmount: input.priorYearContribAmount,
            priorYearContribYear: priorYear,
          })
          .where(eq(schema.contributionAccounts.id, input.id))
          .returning()
          .then((r) => r[0]);
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.id, input.id)),
      ),
  }),

  deductions: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.paycheckDeductions)
        .orderBy(asc(schema.paycheckDeductions.jobId)),
    ),
    create: adminProcedure.input(deductionInput).mutation(({ ctx, input }) =>
      ctx.db
        .insert(schema.paycheckDeductions)
        .values(input)
        .returning()
        .then((r) => r[0]),
    ),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(deductionInput.shape))
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.paycheckDeductions)
          .set(data)
          .where(eq(schema.paycheckDeductions.id, id))
          .returning()
          .then((r) => r[0]),
      ),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db
          .delete(schema.paycheckDeductions)
          .where(eq(schema.paycheckDeductions.id, input.id)),
      ),
  }),
};
