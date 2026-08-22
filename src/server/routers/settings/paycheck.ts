import { z } from "zod/v4";
import { eq, asc, and } from "drizzle-orm";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../../trpc";
import * as schema from "@/lib/db/schema";
import { materializeExtraPaycheckOverrides } from "@/server/helpers/extra-paycheck-materializer";
import {
  accountCategoryEnum,
  getAccountTypeConfig,
  parentCategoryEnum,
} from "@/lib/config/account-types";
import type { AccountCategory } from "@/lib/config/account-types";
import {
  TAX_TREATMENT_VALUES,
  MATCH_TAX_TREATMENT_VALUES,
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

/**
 * A speculative job is a permanent, auto-provisioned peg for Salary
 * Profiles to pin what-if scenarios against (e.g. "moving to Chicago in 5
 * years") — never a real job. Every person gets exactly one (DB-enforced,
 * see `jobs_one_speculative_per_person_idx` in schema-pg.ts), and it must
 * never be treated as a person's real, active job — see
 * findActiveJob/filterActiveJobs in lib/pure/profiles.ts, the single source
 * of truth for that exclusion. Exported so demo.ts and the 0013 migration
 * can use the identical placeholder shape.
 */
export function speculativeJobValues(personId: number) {
  return {
    personId,
    employerName: "Speculative (What-If Planning)",
    startDate: new Date().toISOString().slice(0, 10),
    isSpeculative: true,
  };
}

// A job is purely identity/lifecycle now — payPeriod/payWeek/anchorPayDate/
// w4*/bonus-date/bonus-inclusion-flags/budgetPeriodsPerMonth all moved to
// the Salary Profile entry's complete 16-field shape (see salaryEntrySchema
// in json-schemas.ts) and no longer exist as `jobs` columns at all. Salary/
// bonus amounts were already off this table (see resolveCompensation's
// docblock in server/helpers/salary.ts).
const jobInput = z
  .object({
    personId: z.number().int(),
    employerName: z.string().trim().min(1),
    title: z.string().trim().nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .refine((data) => !data.endDate || data.endDate >= data.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

// A job carries no salary of its own — creating one establishes no
// compensation at all until a Salary Profile gives it a complete entry
// (see resolveCompensation's docblock in server/helpers/salary.ts).
const jobCreateInput = z.object(jobInput.shape);

// contributionMethod/contributionValue are deliberately NOT here — an
// account is purely structural; the actual contribution amount/method is
// ALWAYS a Contribution Profile's active-field entry
// (contributionProfile.update writes it, validated there — see
// jointRequiresJobForPercentOfSalary below, moved to that write boundary
// since it's the only place contributionMethod is ever set now).
const contributionAccountInput = z.object({
  jobId: z.number().int().nullable().optional(),
  personId: z.number().int().nullable(),
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
  taxTreatment: z.enum(TAX_TREATMENT_VALUES),
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

// Several downstream consumers (build-engine-payload.ts's activeContribs
// filter, the engine's salary-fallback matching) treat personId === null as
// synonymous with ownership === "joint". Enforce that invariant at the
// write boundary instead of leaving it as an unenforced convention.
const ownershipPersonIdInvariant = (data: {
  ownership?: string;
  personId: number | null;
}) =>
  data.ownership === "joint" ? data.personId === null : data.personId !== null;
const ownershipPersonIdInvariantIssue = {
  message:
    "personId must be set for individual accounts and null for joint accounts",
  path: ["personId"],
};

// amountPerPeriod is deliberately NOT here — a deduction is purely
// structural now; its dollar amount is ALWAYS a Contribution Profile's
// deductions active-field entry (contributionProfile.update/
// setDeductionActiveFields write it), same no-base-value rule contribution
// accounts already follow. See applyDeductionActiveFields.
const deductionInput = z.object({
  jobId: z.number().int(),
  deductionName: z.string().trim().min(1),
  isPretax: z.boolean(),
  ficaExempt: z.boolean().default(false),
});

// --- Procedures ---

export const paycheckProcedures = {
  people: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db.select().from(schema.people).orderBy(asc(schema.people.id)),
    ),
    create: adminProcedure
      .input(personInput)
      .mutation(async ({ ctx, input }) => {
        const person = await ctx.db
          .insert(schema.people)
          .values(input)
          .returning()
          .then((r) => r[0]!);
        // Provision the speculative-job peg atomically with the person —
        // inserted directly (not via jobs.create) so it doesn't trigger
        // materializeExtraPaycheckOverrides, which a job that never has real
        // routing rules has no need for.
        await ctx.db
          .insert(schema.jobs)
          .values(speculativeJobValues(person.id));
        return person;
      }),
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
      .mutation(async ({ ctx, input }) => {
        // The speculative-job peg is an implementation detail of this
        // person's row, not real employment history — delete it first so
        // it never blocks a person delete via jobs' onDelete: "restrict"
        // FK. Any REAL job still correctly blocks the delete. Both deletes
        // must be one transaction — otherwise a failed person delete (a
        // real job still referencing them) leaves the peg gone with no
        // re-provisioning path.
        return ctx.db.transaction(async (tx) => {
          await tx
            .delete(schema.jobs)
            .where(
              and(
                eq(schema.jobs.personId, input.id),
                eq(schema.jobs.isSpeculative, true),
              ),
            );
          return tx.delete(schema.people).where(eq(schema.people.id, input.id));
        });
      }),
  }),

  jobs: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.jobs)
        .orderBy(asc(schema.jobs.personId), asc(schema.jobs.startDate)),
    ),
    create: adminProcedure
      .input(jobCreateInput)
      .mutation(async ({ ctx, input: jobData }) => {
        const result = await ctx.db
          .insert(schema.jobs)
          .values(jobData)
          .returning()
          .then((r) => r[0]);
        await materializeExtraPaycheckOverrides(ctx.db);
        return result;
      }),
    update: adminProcedure
      .input(z.object({ id: z.number().int() }).extend(jobInput.shape))
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        const result = await ctx.db
          .update(schema.jobs)
          .set(data)
          .where(eq(schema.jobs.id, id))
          .returning()
          .then((r) => r[0]);
        await materializeExtraPaycheckOverrides(ctx.db);
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        const existing = await ctx.db
          .select({ isSpeculative: schema.jobs.isSpeculative })
          .from(schema.jobs)
          .where(eq(schema.jobs.id, input.id));
        if (existing[0]?.isSpeculative) {
          throw new Error(
            "Cannot delete the speculative job — it's a permanent peg for Salary Profile what-if scenarios.",
          );
        }
        await ctx.db.delete(schema.jobs).where(eq(schema.jobs.id, input.id));
        await materializeExtraPaycheckOverrides(ctx.db);
        return { ok: true };
      }),
  }),

  contributionAccounts: createTRPCRouter({
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.contributionAccounts)
        .orderBy(asc(schema.contributionAccounts.personId)),
    ),
    create: adminProcedure
      .input(
        contributionAccountInput.refine(
          ownershipPersonIdInvariant,
          ownershipPersonIdInvariantIssue,
        ),
      )
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
              "Retirement" | "Portfolio";
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
                  "pre_tax" | "tax_free" | "after_tax" | "hsa",
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
          .extend(contributionAccountInput.shape)
          .refine(ownershipPersonIdInvariant, ownershipPersonIdInvariantIssue),
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
              "Retirement" | "Portfolio";
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
