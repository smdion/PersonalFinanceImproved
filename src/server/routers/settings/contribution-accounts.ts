import {
  assertWithinIrsLimits,
  type ContribRowPatch,
} from "@/server/services/contributions/caps";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
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
  EMPLOYER_MATCH_TYPE_VALUES,
  HSA_COVERAGE_TYPE_VALUES,
  ACCOUNT_OWNERSHIP_VALUES,
} from "@/lib/config/enum-values";
import { zDecimal, zFraction } from "@/lib/utils/zod-fields";
import { dropContributionActiveFields } from "@/server/data/delete-references";
import {
  accountMatchWrite,
  refreshEntryRates,
} from "@/server/services/contributions/match-writes";
import { firstRow } from "@/lib/utils/first-row";

// No contributionMethod/contributionValue: an account is structural; the amount and
// method are always a Contribution Profile's active-field entry (contributionProfile.update).
export const contributionAccountInput = z.object({
  jobId: z.number().int().nullable().optional(),
  personId: z.number().int().nullable(),
  accountType: z.enum(accountCategoryEnum()),
  subType: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  parentCategory: z.enum(parentCategoryEnum()).default("Retirement"),
  taxTreatment: z.enum(TAX_TREATMENT_VALUES),
  employerMatchType: z.enum(EMPLOYER_MATCH_TYPE_VALUES),
  employerMatchValue: zDecimal.nullable().optional(),
  // A percent match as a fraction (0.5 = 50%); the value follows it.
  employerMatchRate: zDecimal.nullable().optional(),
  // A fraction of pay (0.06 = 6%); the form converts the percent typed.
  employerMaxMatchPct: zFraction.nullable().optional(),
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

// Downstream consumers treat personId === null as ownership === "joint"; enforce that
// invariant at the write boundary.
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

// IRS contribution limits are per person, so an account type with one
// (401(k), 403(b), IRA, HSA) can't be joint — it needs an owner.
const limitedTypeHasOwner = (data: {
  ownership?: string;
  accountType: string;
}) =>
  !(
    data.ownership === "joint" &&
    getAccountTypeConfig(data.accountType as AccountCategory).hasIrsLimit
  );

const limitedTypeHasOwnerIssue = {
  message:
    "IRS contribution limits are per person — choose who owns this account.",
  path: ["ownership"],
};

export const contributionAccountsProcedures = {
  contributionAccounts: createTRPCRouter({
    /** Every contribution account, by person. */
    list: protectedProcedure.query(({ ctx }) =>
      ctx.db
        .select()
        .from(schema.contributionAccounts)
        .orderBy(asc(schema.contributionAccounts.personId)),
    ),
    /**
     * Add a contribution account. Linked to a performance account, it takes that parent category,
     * and each supported tax treatment without an account there gets an inactive one. Returns it.
     */
    create: adminProcedure
      .input(
        contributionAccountInput
          .refine(ownershipPersonIdInvariant, ownershipPersonIdInvariantIssue)
          .refine(limitedTypeHasOwner, limitedTypeHasOwnerIssue),
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
        const match = accountMatchWrite(input.employerMatchType, input, null);
        const [created] = await ctx.db
          .insert(schema.contributionAccounts)
          .values({
            ...input,
            ...match,
            parentCategory: resolvedParentCategory,
          })
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
                ownership: input.ownership,
                performanceAccountId: input.performanceAccountId,
              })),
            );
          }
        }

        return created;
      }),
    /**
     * Refused over an IRS limit or with a prior-year amount its type can't hold. A linked performance
     * account sets its parent category; Contribution Profile entries follow a match-type change.
     */
    update: adminProcedure
      .input(
        z
          .object({ id: z.number().int() })
          .extend(contributionAccountInput.shape)
          .refine(ownershipPersonIdInvariant, ownershipPersonIdInvariantIssue)
          .refine(limitedTypeHasOwner, limitedTypeHasOwnerIssue),
      )
      .mutation(async ({ ctx, input: { id, ...data } }) => {
        // Validate priorYearContribAmount only allowed for eligible account types
        if (
          data.priorYearContribAmount !== undefined &&
          Number(data.priorYearContribAmount) > 0
        ) {
          const cfg = getAccountTypeConfig(data.accountType as AccountCategory);
          if (!cfg.supportsPriorYearContrib) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Prior-year contributions are not supported for ${data.accountType} accounts`,
            });
          }
        }

        const stored = await ctx.db
          .select({
            performanceAccountId:
              schema.contributionAccounts.performanceAccountId,
            employerMatchValue: schema.contributionAccounts.employerMatchValue,
            employerMatchRate: schema.contributionAccounts.employerMatchRate,
            employerMatchType: schema.contributionAccounts.employerMatchType,
          })
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.id, id))
          .then(firstRow);
        // The incoming performanceAccountId, else the row's.
        const perfAccountId =
          data.performanceAccountId !== undefined
            ? data.performanceAccountId
            : (stored?.performanceAccountId ?? null);

        // When linked to a master account, sync parentCategory from its parentCategory
        const resolvedData = {
          ...data,
          ...accountMatchWrite(data.employerMatchType, data, stored ?? null),
        };
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

        // A change to the account itself (type, owner, coverage, job,
        // bonus or payroll election) can push its contribution over the
        // IRS limit — refused like a value change.
        await assertWithinIrsLimits(
          ctx.db,
          {
            profileId: null,
            rowsAfter: new Map([[id, resolvedData as ContribRowPatch]]),
            touched: [id],
          },
          ctx.scope.asOf,
        );
        return ctx.db.transaction(async (tx) => {
          const updated = await tx
            .update(schema.contributionAccounts)
            .set(resolvedData)
            .where(eq(schema.contributionAccounts.id, id))
            .returning()
            .then(firstRow);
          if (updated) await refreshEntryRates(tx, id, stored, updated);
          return updated;
        });
      }),
    /**
     * Toggle isActive alone, for editors that lack the full account shape. Not
     * profile-owned: the flag gates the account out of computeSummary before profiles resolve.
     */
    setActive: adminProcedure
      .input(z.object({ id: z.number().int(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        // Turning an account back on brings its contribution back — refused
        // if that puts it over its IRS limit.
        if (input.isActive)
          await assertWithinIrsLimits(
            ctx.db,
            {
              profileId: null,
              rowsAfter: new Map([[input.id, { isActive: true }]]),
              touched: [input.id],
            },
            ctx.scope.asOf,
          );
        return ctx.db
          .update(schema.contributionAccounts)
          .set({ isActive: input.isActive })
          .where(eq(schema.contributionAccounts.id, input.id))
          .returning()
          .then(firstRow);
      }),
    /**
     * Record last year's contribution (stamped last year); refused for a type that can't hold one.
     */
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
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Contribution account not found",
          });
        const cfg = getAccountTypeConfig(row.accountType as AccountCategory);
        if (!cfg.supportsPriorYearContrib) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Prior-year contributions are not supported for ${row.accountType} accounts`,
          });
        }
        const priorYear = ctx.scope.asOf.getFullYear() - 1;
        return ctx.db
          .update(schema.contributionAccounts)
          .set({
            priorYearContribAmount: input.priorYearContribAmount,
            priorYearContribYear: priorYear,
          })
          .where(eq(schema.contributionAccounts.id, input.id))
          .returning()
          .then(firstRow);
      }),
    /**
     * Delete a contribution account and its entry in every Contribution Profile.
     */
    delete: adminProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(({ ctx, input }) =>
        ctx.db.transaction(async (tx) => {
          await dropContributionActiveFields(
            tx,
            "contributionAccounts",
            input.id,
          );
          await tx
            .delete(schema.contributionAccounts)
            .where(eq(schema.contributionAccounts.id, input.id));
        }),
      ),
  }),
};
