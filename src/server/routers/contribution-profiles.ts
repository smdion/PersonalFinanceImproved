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
import { taxTreatmentToShortLabel } from "@/lib/config/display-labels";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import { readContributionActiveFields } from "@/lib/db/stored-active-fields";
import { loadLiveContribData } from "@/server/services/contributions/live-data";
import { resolveProfile } from "@/server/services/contributions/profile";
import { getIncompleteContribAccountIds } from "@/lib/pure/contributions/profile-fields";
import { aggregateContributionsByCategory } from "@/lib/pure/contributions/category-totals";
import { portfolioAccountLabel } from "@/lib/pure/accounts/portfolio-labels";
import { getDisplayConfig } from "@/lib/config/account-types";
import {
  contributionActiveFieldsSchema,
  contribAccountActiveFieldsSchema,
  contribAccountActiveFieldsPatchSchema,
  deductionActiveFieldsSchema,
} from "@/lib/db/json-schemas";
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

// ── Active-field shape validation (write-only — reads tolerate unexpected fields) ──
// Schemas imported from @/lib/db/json-schemas as centralized schemas.

const ContributionActiveFieldsSchema = contributionActiveFieldsSchema;
type Entry = Record<string, unknown>;

/**
 * A joint account with no jobId has no salary to resolve percent_of_salary against
 * (it would compute $0). contributionMethod is set only in profiles, so every write that
 * can set percent_of_salary (create, update, setAccountActiveFields) runs this check.
 */
async function assertNoJointPercentOfSalaryWithoutJob(
  db: Db,
  contributionActiveFields:
    | { contributionAccounts?: Record<string, { contributionMethod?: string }> }
    | undefined,
): Promise<void> {
  const incomingAccounts = contributionActiveFields?.contributionAccounts ?? {};
  const percentOfSalaryIds = Object.entries(incomingAccounts)
    .filter(([, f]) => f.contributionMethod === "percent_of_salary")
    .map(([id]) => Number(id));
  if (percentOfSalaryIds.length === 0) return;

  const accounts = await db
    .select({
      id: schema.contributionAccounts.id,
      ownership: schema.contributionAccounts.ownership,
      jobId: schema.contributionAccounts.jobId,
    })
    .from(schema.contributionAccounts)
    .where(inArray(schema.contributionAccounts.id, percentOfSalaryIds));
  const invalid = accounts.find((a) => a.ownership === "joint" && !a.jobId);
  if (invalid) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Joint accounts using percent-of-salary contributions must be linked to a specific job",
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
  compareData: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select()
      .from(schema.contributionProfiles)
      .orderBy(schema.contributionProfiles.createdAt);

    const { rawContribRows, peopleMap, jobs, perfAccountMap } =
      await loadLiveContribData(ctx.db, ctx.scope.asOf);
    // portfolioAccountLabel wants id → name; peopleMap is id → person row.
    const nameMap = new Map(
      Array.from(peopleMap.values(), (p) => [p.id, p.name] as const),
    );

    const accounts = rawContribRows.map((row) => {
      const perfAccount =
        row.performanceAccountId != null
          ? perfAccountMap.get(row.performanceAccountId)
          : undefined;
      // The institution comes from the linked performance account; the owner's
      // current employer is a stand-in only for an account with no link yet.
      const institution =
        perfAccount?.institution ??
        jobs.find(
          (j) => j.personId === row.personId && !j.endDate && !j.isSpeculative,
        )?.employerName ??
        "";
      // A row with its own personId is person-specific (limits are per person) even
      // under a jointly tracked account, so it gets its owner's label; joint rows
      // (personId null) use the account's ownershipType. Shared rule in portfolio-labels.ts.
      const accountName = portfolioAccountLabel(
        {
          accountType: row.accountType,
          subType: row.subType,
          label: row.label,
          institution,
        },
        perfAccount
          ? {
              displayName: perfAccount.displayName,
              accountLabel: perfAccount.accountLabel,
              ownershipType: perfAccount.ownershipType,
            }
          : undefined,
        row.personId,
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
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      const profile = rows[0];
      if (!profile) return null;

      const {
        contribs,
        jobs,
        jobSalaries,
        rawContribRows,
        peopleMap,
        perfAccountMap,
        salaryProfileActiveMap,
      } = await loadLiveContribData(ctx.db, ctx.scope.asOf);
      // portfolioAccountLabel wants id → name; peopleMap here is id → full
      // person row (still needed below for the fuzzy-suggestion matcher).
      const nameMap = new Map(
        Array.from(peopleMap.values(), (p) => [p.id, p.name] as const),
      );
      const resolved = resolveProfile(
        profile,
        contribs,
        jobs,
        jobSalaries,
        salaryProfileActiveMap,
      );

      // Build per-account detail for the editor UI
      const {
        contributionAccounts: accountActiveFields,
        deductions: deductionActiveFields,
      } = readContributionActiveFields(
        profile.contributionActiveFields,
        profile.id,
      );
      // Convert perfAccountMap to array for fallback matching
      const allPerfAccounts = Array.from(perfAccountMap.values());

      const accountDetails = rawContribRows.map((row) => {
        const activeFields = accountActiveFields[String(row.id)];
        const person =
          row.personId != null ? peopleMap.get(row.personId) : undefined;

        // Resolve linked performance account via explicit FK (primary path)
        const perfAccount = row.performanceAccountId
          ? (perfAccountMap.get(row.performanceAccountId) ?? null)
          : null;

        // DEPRECATED: fuzzy match by person + type — used as a display hint only (not for data operations).
        // Will be removed once all contribution accounts are backfilled with performanceAccountId
        // via settings.backfillPerformanceAccountIds.
        let suggestedPerfAccount: typeof perfAccount = null;
        if (!perfAccount) {
          const display = getDisplayConfig(row.accountType, row.subType);
          const typeLabel = display.displayLabel.toLowerCase();
          const personName = person?.name.toLowerCase() ?? "";
          suggestedPerfAccount =
            allPerfAccounts.find((pa) => {
              const labelLower = pa.accountLabel.toLowerCase();
              return (
                labelLower.includes(typeLabel) &&
                (pa.ownerPersonId === row.personId ||
                  labelLower.includes(personName))
              );
            }) ?? null;
        }

        // For display purposes, use the explicit link; fall back to fuzzy suggestion for name rendering only
        const displayPerfAccount = perfAccount ?? suggestedPerfAccount;

        // Derive institution: perf account link → person's job employer → fallback empty
        const institution =
          displayPerfAccount?.institution ??
          jobs.find(
            (j) =>
              j.personId === row.personId && !j.endDate && !j.isSpeculative,
          )?.employerName ??
          "";

        // A row with its own personId gets its owner's label even under a jointly
        // tracked account (see compareData above; rule in portfolio-labels.ts).
        const accountName = portfolioAccountLabel(
          {
            accountType: row.accountType,
            subType: row.subType,
            label: row.label,
            institution,
          },
          displayPerfAccount
            ? {
                displayName: displayPerfAccount.displayName,
                accountLabel: displayPerfAccount.accountLabel,
                ownershipType: displayPerfAccount.ownershipType,
              }
            : undefined,
          row.personId,
          nameMap,
        );

        // Disambiguate when multiple contrib accounts share the same display name
        // (e.g., Trad vs Roth 401k) by appending tax treatment
        const taxLabel = taxTreatmentToShortLabel(row.taxTreatment);
        const sameName = rawContribRows.filter((r) => {
          if (r.id === row.id) return false;
          // Same person + same account type = siblings that need disambiguation
          return (
            r.personId === row.personId && r.accountType === row.accountType
          );
        });
        const disambiguatedName =
          sameName.length > 0 ? `${accountName} — ${taxLabel}` : accountName;

        const displayNameCustom = activeFields?.displayNameCustom as
          string | undefined;

        return {
          id: row.id,
          accountType: row.accountType,
          subType: row.subType,
          label: row.label,
          accountName: displayNameCustom || disambiguatedName,
          liveAccountName: disambiguatedName,
          personId: row.personId,
          taxTreatment: row.taxTreatment,
          parentCategory: row.parentCategory,
          // Live values: no method or value (only a profile's entry has
          // them; see applyContribActiveFields).
          liveMatchType: row.employerMatchType,
          liveMatchValue: row.employerMatchValue,
          liveMatchRate: row.employerMatchRate,
          liveMaxMatchPct: row.employerMaxMatchPct,
          liveIsActive: row.isActive,
          /** Paid through payroll — only these can be taken from bonus checks. */
          liveIsPayroll: isPaidThroughPayroll(row),
          // Active values — null means this profile has no value at all for
          // this account (isIncomplete), not "falls back to a live value".
          activeFields: activeFields ?? null,
          isIncomplete: activeFields == null,
        };
      });

      // Deductions have no live value of their own: exclude-if-absent, like a
      // contribution account's contributionValue (see applyDeductionActiveFields).
      const allDeductions = await ctx.db
        .select()
        .from(schema.paycheckDeductions);
      const deductionDetails = allDeductions.map((d) => {
        const activeFields = deductionActiveFields[String(d.id)];
        const job = jobs.find((j) => j.id === d.jobId);
        return {
          id: d.id,
          jobId: d.jobId,
          employerName: job?.employerName ?? null,
          deductionName: d.deductionName,
          isPretax: d.isPretax,
          ficaExempt: d.ficaExempt,
          activeFields: activeFields ?? null,
          isIncomplete: activeFields?.amountPerPeriod === undefined,
        };
      });

      return {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        accountDetails,
        deductionDetails,
        resolved: {
          combinedSalary: resolved.combinedSalary,
        },
      };
    }),

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
      await assertNoJointPercentOfSalaryWithoutJob(
        ctx.db,
        input.contributionActiveFields,
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
        assertNoJointPercentOfSalaryWithoutJob(ctx.db, fields),
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

      await assertNoJointPercentOfSalaryWithoutJob(
        ctx.db,
        input.contributionActiveFields,
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
      if (input.fields.contributionMethod === "percent_of_salary") {
        const [account] = await ctx.db
          .select({
            ownership: schema.contributionAccounts.ownership,
            jobId: schema.contributionAccounts.jobId,
          })
          .from(schema.contributionAccounts)
          .where(eq(schema.contributionAccounts.id, input.accountId));
        if (account?.ownership === "joint" && !account.jobId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Joint accounts using percent-of-salary contributions must be linked to a specific job",
          });
        }
      }

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
