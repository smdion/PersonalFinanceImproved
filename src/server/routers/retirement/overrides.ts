import { eq, asc } from "drizzle-orm";
import { z } from "zod/v4";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
  brokerageProcedure,
  getSessionUserLabel,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { zDecimal, zYear } from "@/lib/utils/zod-fields";
import { firstRow } from "@/lib/utils/first-row";
import { accountCategoryEnum } from "@/lib/config/account-types";
import { decumulationOverrideArraySchema } from "@/lib/pure/engine/types";
import { accumulationOverrideArraySchema } from "@/server/services/projection/projection-run";

/** What each kind's saved set reads as: the projection's override shapes
 *  (resolveProjectionOverrides) and the Brokerage page's planned events
 *  (built on call: the account types are read at call time). */
function savedSetShape(kind: "accumulation" | "decumulation" | "brokerage") {
  if (kind === "accumulation") return accumulationOverrideArraySchema;
  if (kind === "decumulation") return decumulationOverrideArraySchema;
  return z.array(
    z.object({
      id: z.string(),
      year: z.string(),
      amount: z.string(),
      targetAccount: z.enum(accountCategoryEnum()),
      targetAccountName: z.string(),
      targetOwnerName: z.string(),
      targetPerformanceAccountId: z.number().int().nullable().optional(),
      targetOwnerPersonId: z.number().int().nullable().optional(),
      taxType: z.enum(["traditional", "roth", ""]),
      label: z.string(),
    }),
  );
}

export const overrideProcedures = {
  retirementSalaryOverrides: createTRPCRouter({
    /**
     * Every salary change by year (a person's salary for a projection year), by year.
     */
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
          projectionYear: zYear,
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementSalaryOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then(firstRow),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: zYear,
          overrideSalary: zDecimal,
          contributionProfileId: z.number().int().nullable().optional(),
          salaryProfileId: z.number().int().nullable().optional(),
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input: { id, ...data } }) =>
        ctx.db
          .update(schema.retirementSalaryOverrides)
          .set({ ...data, updatedBy: getSessionUserLabel(ctx.session) })
          .where(eq(schema.retirementSalaryOverrides.id, id))
          .returning()
          .then(firstRow),
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
    /**
     * Every retirement budget change by year (a monthly amount for a projection year), by year.
     */
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
          projectionYear: zYear,
          overrideMonthlyBudget: zDecimal,
          notes: z.string().nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        ctx.db
          .insert(schema.retirementBudgetOverrides)
          .values({ ...input, createdBy: getSessionUserLabel(ctx.session) })
          .returning()
          .then(firstRow),
      ),
    update: adminProcedure
      .input(
        z.object({
          id: z.number().int(),
          personId: z.number().int(),
          projectionYear: zYear,
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
          .then(firstRow),
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
    /**
     * One kind's saved changes by year (accumulation, decumulation or brokerage); [] when none.
     */
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
          .then((r) => r[0]?.overrides ?? []),
      ),
    /**
     * Replace one kind's saved changes by year, at the brokerage permission for every kind;
     * a set its kind's shape refuses is refused, and a set is stored as sent.
     */
    save: brokerageProcedure
      .input(
        z
          .object({
            overrideType: z.enum(["accumulation", "decumulation", "brokerage"]),
            overrides: z.array(z.record(z.string(), z.unknown())),
          })
          .superRefine(({ overrideType, overrides }, check) => {
            const refused = savedSetShape(overrideType).safeParse(overrides);
            for (const issue of refused.error?.issues ?? [])
              check.addIssue({
                code: "custom",
                path: ["overrides", ...issue.path],
                message: issue.message,
              });
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
          .then(firstRow),
      ),
    /**
     * Delete one kind's saved changes by year, at the brokerage permission for every kind.
     */
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
};
