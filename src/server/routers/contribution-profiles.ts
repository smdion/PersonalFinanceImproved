/**
 * CRUD + resolution for Contribution Profiles (no salary: `loadLiveContribData` uses the
 * globally active Salary Profile). Every profile is an ordinary row; empty
 * contributionActiveFields means nothing set.
 */
import {
  assertWithinIrsLimits,
  switchProfileLimitWarning,
  capResolvedProfile,
  loadCapHousehold,
  touchedContribAccounts,
} from "@/server/services/contributions/caps";
import { getAllPeople } from "@/server/data/people";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { z } from "zod/v4";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { createTRPCRouter } from "../trpc";
import {
  JOINT_PERCENT_REFUSED,
  taxTreatmentToShortLabel,
} from "@/lib/config/display-labels";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { loadLiveContribData } from "@/server/services/contributions/live-data";
import { resolveProfile } from "@/server/services/contributions/profile";
import { getIncompleteContribAccountIds } from "@/lib/pure/contributions/profile-fields";
import { isJointPercentRow } from "@/lib/pure/contributions/row-pay";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import { contributionAccountName } from "@/server/services/contributions/account-name";
import {
  contributionActiveFieldsSchema,
  contribAccountActiveFieldsSchema,
  contribAccountActiveFieldsPatchSchema,
  deductionActiveFieldsSchema,
} from "@/lib/db/shapes/json-schemas";
import type { Db } from "@/lib/db";
import {
  activeFieldsWithMatchRates,
  entriesWithMatchRates,
  withMatchRateUnset,
} from "@/server/services/contributions/match-writes";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  setActiveProfile,
} from "@/server/services/profiles/profile-lifecycle";
import { loadContributionProfileDetail } from "@/server/services/contributions/profile-detail";

// ── Active-field shape validation (write-only — reads tolerate unexpected fields) ──
// Schemas imported from @/lib/db/shapes/json-schemas as centralized schemas.

const ContributionActiveFieldsSchema = contributionActiveFieldsSchema;
type Entry = Record<string, unknown>;

/**
 * Refuse profile fields that would give a joint account with no job a percent (isJointPercentRow),
 * each read over its account's stored fields. Every write that sets a method or a match type runs it.
 */
async function assertNoJointPercent(
  db: Db,
  entries:
    | Record<
        string,
        { contributionMethod?: string; employerMatchType?: string | null }
      >
    | undefined,
): Promise<void> {
  const ids = Object.keys(entries ?? {}).map(Number);
  if (!entries || ids.length === 0) return;
  const accounts = await db
    .select({
      id: schema.contributionAccounts.id,
      ownership: schema.contributionAccounts.ownership,
      jobId: schema.contributionAccounts.jobId,
      employerMatchType: schema.contributionAccounts.employerMatchType,
    })
    .from(schema.contributionAccounts)
    .where(inArray(schema.contributionAccounts.id, ids));
  for (const account of accounts) {
    const entry = entries[String(account.id)];
    const row = {
      ...account,
      contributionMethod: entry?.contributionMethod,
      employerMatchType: entry?.employerMatchType ?? account.employerMatchType,
    };
    if (isJointPercentRow(row))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          row.contributionMethod === "percent_of_salary"
            ? JOINT_PERCENT_REFUSED.salary
            : JOINT_PERCENT_REFUSED.match,
      });
  }
}

/** The transactional read-merge-write of one active-fields sub-entry (an
 *  account or a deduction): merge, validate, delete-if-empty, write back. */
async function patchProfileSubEntry<T extends Record<string, unknown>>(
  tx: Db,
  profileId: number,
  subKey: "contributionAccounts" | "deductions",
  entryId: number,
  fields: Record<string, unknown>,
  unset: string[] | undefined,
  entrySchema: z.ZodType<T>,
  errorLabel: string,
  /** Runs on the sub-map before and after the patch, before it's written
   *  (throws to refuse). */
  check?: (
    before: Record<string, Record<string, unknown>>,
    after: Record<string, Record<string, unknown>>,
  ) => Promise<void>,
  /** Completes the merged entry before it's validated (the match rate). */
  prepare?: (entry: Entry, before: Entry | undefined) => Promise<Entry>,
): Promise<typeof schema.contributionProfiles.$inferSelect> {
  const existing = await tx
    .select()
    .from(schema.contributionProfiles)
    .where(eq(schema.contributionProfiles.id, profileId));
  const profile = existing[0];
  if (!profile)
    throw new TRPCError({ code: "NOT_FOUND", message: "Profile not found" });

  const root = profile.contributionActiveFields as Record<
    string,
    Record<string, Record<string, unknown>> | undefined
  >;
  const old = root[subKey]?.[String(entryId)];
  const patched: Entry = { ...old };
  for (const key of unset ?? []) delete patched[key];
  Object.assign(patched, fields);
  const mergedEntry = prepare ? await prepare(patched, old) : patched;

  const parsed = entrySchema.safeParse(mergedEntry);
  if (!parsed.success) {
    // Message only, no `cause` — see salary-profiles.ts patchEntry.
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid ${errorLabel} after patch: ${parsed.error.issues[0]?.message}`,
    });
  }

  // A fully-unset entry is removed, not stored as `{}` (both mean the same to
  // getIncompleteContribAccountIds; only absence is stored).
  const nextSub = { ...root[subKey] };
  if (Object.keys(parsed.data).length === 0) {
    delete nextSub[String(entryId)];
  } else {
    nextSub[String(entryId)] = parsed.data;
  }
  await check?.(
    (root[subKey] ?? {}) as Record<string, Record<string, unknown>>,
    nextSub as Record<string, Record<string, unknown>>,
  );
  const nextActiveFields = { ...root, [subKey]: nextSub };

  const rows = await tx
    .update(schema.contributionProfiles)
    .set({
      contributionActiveFields:
        nextActiveFields as typeof profile.contributionActiveFields,
    })
    .where(eq(schema.contributionProfiles.id, profileId))
    .returning();
  return rows[0]!;
}

export const contributionProfileRouter = createTRPCRouter({
  /**
   * List all contribution profiles with resolved summary totals.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select()
      .from(schema.contributionProfiles)
      .orderBy(schema.contributionProfiles.createdAt);

    // Load live data for resolving summaries
    const {
      contribs,
      jobs,
      jobSalaries,
      rawContribRows,
      salaryProfileActiveMap,
    } = await loadLiveContribData(ctx.db, ctx.scope.asOf);
    const capHousehold = await loadCapHousehold(
      ctx.db,
      await getAllPeople(ctx.db),
      null,
      ctx.scope.asOf,
    );

    const resolved = profiles.map((profile) => {
      const r = resolveProfile(
        profile,
        contribs,
        jobs,
        jobSalaries,
        salaryProfileActiveMap,
      );
      const agg = aggregateContributionsByCategory(
        capResolvedProfile(r, capHousehold),
        r.activeJobs,
        r.jobSalaries,
      );

      const totalContributions = Object.values(agg.contribByCategory).reduce(
        (sum, cat) => sum + cat.annual,
        0,
      );
      const totalMatch = Object.values(agg.employerMatchByCategory).reduce(
        (sum, val) => sum + val,
        0,
      );

      const accountActiveFields = readContributionActiveFields(
        profile.contributionActiveFields,
        profile.id,
      ).contributionAccounts;

      return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        createdAt: profile.createdAt.toISOString(),
        activeFieldCount: Object.keys(accountActiveFields).length,
        // How many live accounts this profile has no value for at all —
        // surfaced so an incomplete profile is never a silent gap (see
        // getIncompleteContribAccountIds).
        incompleteAccountCount: getIncompleteContribAccountIds(
          rawContribRows,
          accountActiveFields,
        ).length,
        summary: {
          combinedSalary: r.combinedSalary,
          annualContributions: totalContributions,
          annualEmployerMatch: totalMatch,
        },
      };
    });

    return resolved;
  }),

  /**
   * Lightweight data for the Compare view and swap-time diff: each account's live values
   * plus each profile's raw active-fields map, keyed by account id. Skips `getById`'s
   * per-profile perf-account matching and name disambiguation.
   */
  getComparisonData: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select()
      .from(schema.contributionProfiles)
      .orderBy(schema.contributionProfiles.createdAt);

    const { rawContribRows, peopleMap, jobs, perfAccountMap } =
      await loadLiveContribData(ctx.db, ctx.scope.asOf);
    // contributionAccountName wants id → name; peopleMap is id → person row.
    const nameMap = new Map(
      Array.from(peopleMap.values(), (p) => [p.id, p.name] as const),
    );

    const accounts = rawContribRows.map((row) => {
      const accountName = contributionAccountName(
        row,
        { perfAccountMap, jobs },
        nameMap,
      );
      // Same-person/same-type siblings need disambiguating, same rule
      // getById's accountDetails uses — otherwise two 401k rows for one
      // person would render as identical column labels.
      const sameName = rawContribRows.filter(
        (r) =>
          r.id !== row.id &&
          r.personId === row.personId &&
          r.accountType === row.accountType,
      );
      const taxLabel = taxTreatmentToShortLabel(row.taxTreatment);
      return {
        id: row.id,
        accountName:
          sameName.length > 0 ? `${accountName} — ${taxLabel}` : accountName,
        /** Only a payroll account can be taken from bonus checks. */
        isPayroll: isPaidThroughPayroll(row),
        live: {
          // No contribution value or method: only a profile's entry has one.
          employerMatchType: row.employerMatchType,
          employerMatchValue: row.employerMatchValue,
          employerMatchRate: row.employerMatchRate,
          employerMaxMatchPct: row.employerMaxMatchPct,
          autoMaximize: row.autoMaximize,
          isActive: row.isActive,
        },
      };
    });

    return {
      accounts,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        accountActiveFields: readContributionActiveFields(
          p.contributionActiveFields,
          p.id,
        ).contributionAccounts,
      })),
    };
  }),

  /**
   * Get a single profile with fully resolved per-account details.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => loadContributionProfileDetail(ctx, input)),

  /**
   * Create a new contribution profile.
   */
  create: contributionProfileProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        contributionActiveFields: ContributionActiveFieldsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNoJointPercent(
        ctx.db,
        input.contributionActiveFields.contributionAccounts,
      );
      const contributionActiveFields = await activeFieldsWithMatchRates(
        ctx.db,
        input.contributionActiveFields,
        {},
      );
      return createProfile(ctx.db, "contribution", {
        ...input,
        contributionActiveFields,
      });
    }),

  /** Copy a profile's contributionActiveFields into a new profile, verbatim:
   *  a value map keyed by account id, with no owned rows to duplicate. */
  duplicate: contributionProfileProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(({ ctx, input }) =>
      duplicateProfile(ctx.db, "contribution", input, (fields) =>
        assertNoJointPercent(ctx.db, fields.contributionAccounts),
      ),
    ),

  /**
   * Update an existing contribution profile.
   */
  update: contributionProfileProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullish(),
        // Without the schema's own default: absent means "unchanged" — a
        // rename or description edit must never replace the profile's
        // values with the empty default.
        contributionActiveFields:
          ContributionActiveFieldsSchema.unwrap().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      if (!existing[0])
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Profile not found",
        });

      await assertNoJointPercent(
        ctx.db,
        input.contributionActiveFields?.contributionAccounts,
      );
      // Over the limits on a future switch: saved, with a warning.
      const { asOf } = ctx.scope;
      let limitWarning: string | null = null;
      const before = readContributionActiveFields(
        existing[0].contributionActiveFields,
        input.id,
      ).contributionAccounts;
      const incoming =
        input.contributionActiveFields &&
        (await activeFieldsWithMatchRates(
          ctx.db,
          input.contributionActiveFields,
          before,
        ));
      if (incoming) {
        const after = incoming.contributionAccounts;
        const check = {
          profileId: input.id,
          before,
          after,
          touched: touchedContribAccounts(before, after),
        };
        await assertWithinIrsLimits(ctx.db, check, asOf);
        limitWarning = await switchProfileLimitWarning(ctx.db, check, asOf);
      }

      const updates: Partial<typeof schema.contributionProfiles.$inferInsert> =
        {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description ?? null;
      if (incoming !== undefined) updates.contributionActiveFields = incoming;

      const rows = await ctx.db
        .update(schema.contributionProfiles)
        .set(updates)
        .where(eq(schema.contributionProfiles.id, input.id))
        .returning();
      return { ...rows[0]!, limitWarning };
    }),

  /** Patch one account's active fields in a profile, in one transaction:
   *  `fields` sets keys, `unset` removes them; the merged entry is validated
   *  (contributionValue and contributionMethod together, or neither). */
  setAccountActiveFields: contributionProfileProcedure
    .input(
      z.object({
        profileId: z.number(),
        accountId: z.number(),
        fields: contribAccountActiveFieldsPatchSchema,
        unset: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertNoJointPercent(ctx.db, {
        [input.accountId]: input.fields,
      });

      const { asOf } = ctx.scope;
      let limitWarning: string | null = null;
      const row = await ctx.db.transaction((tx) =>
        patchProfileSubEntry(
          tx,
          input.profileId,
          "contributionAccounts",
          input.accountId,
          input.fields,
          withMatchRateUnset(input.unset),
          contribAccountActiveFieldsSchema,
          "contribution account fields",
          // Over the IRS limit: refused on the active profile, else warned.
          async (before, after) => {
            const check = {
              profileId: input.profileId,
              before,
              after,
              touched: touchedContribAccounts(before, after),
            };
            await assertWithinIrsLimits(tx, check, asOf);
            limitWarning = await switchProfileLimitWarning(tx, check, asOf);
          },
          (entry, before) =>
            entriesWithMatchRates(
              tx,
              { [input.accountId]: entry },
              { [input.accountId]: before },
              () => "employerMatchRate" in input.fields,
            ).then((e) => e[input.accountId]!),
        ),
      );
      // Set inside the check callback, which TypeScript doesn't follow.
      return { ...row, limitWarning: limitWarning as string | null };
    }),

  /**
   * Patch one deduction's active amount within a profile (same pattern as
   * setAccountActiveFields): the only way a deduction gets a resolvable value.
   */
  setDeductionActiveFields: contributionProfileProcedure
    .input(
      z.object({
        profileId: z.number(),
        deductionId: z.number(),
        fields: deductionActiveFieldsSchema,
        unset: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction((tx) =>
        patchProfileSubEntry(
          tx,
          input.profileId,
          "deductions",
          input.deductionId,
          input.fields,
          input.unset,
          deductionActiveFieldsSchema,
          "deduction fields",
        ),
      );
    }),

  /**
   * Delete a contribution profile. Blocked for the last one, the globally-active one, and
   * one any Plan uses (the scenarios FK is `set null`, so deleting would unset those Plans).
   */
  delete: contributionProfileProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ ctx, input }) =>
      deleteProfile(ctx.db, "contribution", input.id),
    ),

  /** Make a profile the globally-active one, or clear the setting (null),
   *  under the contributionProfile permission, not admin. */
  setActive: contributionProfileProcedure
    .input(z.object({ id: z.number().nullable() }))
    .mutation(({ ctx, input }) =>
      setActiveProfile(ctx.db, "contribution", input.id),
    ),
});
