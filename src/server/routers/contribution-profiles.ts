/**
 * Contribution Profiles Router
 *
 * CRUD + resolution for named contribution profiles.
 * Profiles are managed on the budget page (the what-if control center)
 * and consumed by the relocation tool and potentially the retirement page.
 *
 * Salary is NOT part of a Contribution Profile — it lives on the independent
 * salaryProfile router. `loadLiveContribData` resolves salary against
 * whichever Salary Profile is globally ACTIVE (a job has no salary of its
 * own); these endpoints never pair with a specific, caller-chosen Salary
 * Profile.
 *
 * There is no `isDefault` flag and no synthetic id-0 "Live" row: every
 * profile is an ordinary, renamable, editable row, and one with empty
 * contributionActiveFields is simply a profile with nothing customized.
 */
import { z } from "zod/v4";
import { eq, inArray } from "drizzle-orm";
import { createTRPCRouter } from "../trpc";
import { canDeleteContribProfile } from "@/lib/pure/profiles";
import { taxTreatmentToShortLabel } from "@/lib/config/display-labels";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  aggregateContributionsByCategory,
  loadLiveContribData,
  resolveProfile,
  getIncompleteContribAccountIds,
  type Db,
} from "@/server/helpers";
import { accountDisplayName } from "@/lib/utils/format";
import { getDisplayConfig } from "@/lib/config/account-types";
import {
  contributionActiveFieldsSchema,
  contribAccountActiveFieldsSchema,
  contribAccountActiveFieldsPatchSchema,
  deductionActiveFieldsSchema,
} from "@/lib/db/json-schemas";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

// ── Active-field shape validation (write-only — reads tolerate unexpected fields) ──
// Schemas imported from @/lib/db/json-schemas as centralized schemas.

const ContributionActiveFieldsSchema = contributionActiveFieldsSchema;

/**
 * A joint account with no jobId has no single person's salary to resolve
 * percent_of_salary against — the salary-resolution fallback in
 * server/helpers/contribution.ts falls back to job-by-personId, which is
 * null for joint accounts, silently computing a $0 salary instead of the
 * intended percentage. contributionMethod is only ever set here now
 * (accounts carry no method of their own), so every write path that can
 * set it to percent_of_salary (create, update, setAccountActiveFields)
 * must run this same check.
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
    throw new Error(
      "Joint accounts using percent-of-salary contributions must be linked to a specific job",
    );
  }
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
    } = await loadLiveContribData(ctx.db);

    const resolved = profiles.map((profile) => {
      const r = resolveProfile(
        profile,
        contribs,
        jobs,
        jobSalaries,
        salaryProfileActiveMap,
      );
      const agg = aggregateContributionsByCategory(
        r.activeContribs,
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

      const accountActiveFields =
        (
          profile.contributionActiveFields as Record<
            string,
            Record<string, Record<string, unknown>>
          >
        ).contributionAccounts ?? {};

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
   * Lightweight data for the Compare view (R20) and the swap-time diff:
   * every account's live values plus every profile's raw active-fields
   * map, keyed by account id. Deliberately skips what `getById` does per
   * profile — perf-account fuzzy matching and full display-name
   * disambiguation — since those only need to happen once per account row,
   * not once per profile × account. `loadLiveContribData` itself still
   * only runs once for the whole request, same as `list` above.
   */
  compareData: protectedProcedure.query(async ({ ctx }) => {
    const profiles = await ctx.db
      .select()
      .from(schema.contributionProfiles)
      .orderBy(schema.contributionProfiles.createdAt);

    const { rawContribRows, peopleMap, jobs, perfAccountMap } =
      await loadLiveContribData(ctx.db);

    const accounts = rawContribRows.map((row) => {
      const person =
        row.personId != null ? peopleMap.get(row.personId) : undefined;
      const perfAccount =
        row.performanceAccountId != null
          ? perfAccountMap.get(row.performanceAccountId)
          : undefined;
      // The real institution (where the account is actually held) comes
      // from the linked performance account. Falling back to the person's
      // current employer only covers the rare case of a contribution
      // account with no performance-account link yet — using employer as
      // a stand-in for institution is wrong for anything not actually
      // employer-sponsored (e.g. an IRA), which is exactly what happened
      // here before: every account showed the owner's current job's name
      // regardless of where the account is actually held.
      const institution =
        perfAccount?.institution ??
        jobs.find(
          (j) => j.personId === row.personId && !j.endDate && !j.isSpeculative,
        )?.employerName ??
        "";
      const accountName = accountDisplayName(
        {
          accountType: row.accountType,
          subType: row.subType,
          label: row.label,
          institution,
          displayName: perfAccount?.displayName ?? null,
          accountLabel: perfAccount?.accountLabel ?? null,
          ownershipType: perfAccount?.ownershipType ?? null,
        },
        person?.name,
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
        live: {
          // No contributionValue/contributionMethod here — accounts carry
          // no value of their own anymore (see applyContribActiveFields);
          // every profile's own active field is the only source.
          employerMatchType: row.employerMatchType,
          employerMatchValue: row.employerMatchValue,
          employerMaxMatchPct: row.employerMaxMatchPct,
          autoMaximize: row.autoMaximize,
          isActive: row.isActive,
        },
      };
    });

    return {
      accounts,
      profiles: profiles.map((p) => {
        const root = p.contributionActiveFields as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
        return {
          id: p.id,
          name: p.name,
          accountActiveFields: root.contributionAccounts ?? {},
        };
      }),
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
      } = await loadLiveContribData(ctx.db);
      const resolved = resolveProfile(
        profile,
        contribs,
        jobs,
        jobSalaries,
        salaryProfileActiveMap,
      );

      // Build per-account detail for the editor UI
      const contribActiveFieldsRoot =
        profile.contributionActiveFields as Record<
          string,
          Record<string, Record<string, unknown>>
        >;
      const accountActiveFields =
        (contribActiveFieldsRoot.contributionAccounts ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
      const deductionActiveFields = (contribActiveFieldsRoot.deductions ??
        {}) as Record<string, Record<string, unknown>>;
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
          const personName = person?.name?.toLowerCase() ?? "";
          suggestedPerfAccount =
            allPerfAccounts.find((pa) => {
              const labelLower = (pa.accountLabel ?? "").toLowerCase();
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

        // Use the shared accountDisplayName function — always pass institution so
        // the fallback path produces "Alex 401(k) (TechCorp)" not just "401k"
        const accountName = accountDisplayName(
          {
            accountType: row.accountType,
            subType: row.subType,
            label: row.label,
            institution,
            displayName: displayPerfAccount?.displayName ?? null,
            accountLabel: displayPerfAccount?.accountLabel ?? null,
            ownershipType: displayPerfAccount?.ownershipType ?? null,
          },
          person?.name,
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

        const displayNameActive = activeFields?.displayNameActive as
          string | undefined;

        return {
          id: row.id,
          accountType: row.accountType,
          subType: row.subType,
          label: row.label,
          accountName: displayNameActive || disambiguatedName,
          liveAccountName: disambiguatedName,
          personId: row.personId,
          taxTreatment: row.taxTreatment,
          parentCategory: row.parentCategory,
          // Live values — no liveMethod/liveValue: accounts carry no
          // contribution value/method of their own anymore, only this
          // profile's activeFields does (see applyContribActiveFields).
          liveMatchType: row.employerMatchType,
          liveMatchValue: row.employerMatchValue,
          liveMaxMatchPct: row.employerMaxMatchPct,
          liveIsActive: row.isActive,
          // Active values — null means this profile has no value at all for
          // this account (isIncomplete), not "falls back to a live value".
          activeFields: activeFields ?? null,
          isIncomplete: activeFields == null,
        };
      });

      // Deductions have no live value on their own any more (Stage B
      // dropped paycheck_deductions.amount_per_period) — same no-base-value,
      // exclude-if-absent contract as a contribution account's
      // contributionValue (see applyDeductionActiveFields).
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

      const rows = await ctx.db
        .insert(schema.contributionProfiles)
        .values({
          name: input.name,
          description: input.description ?? null,
          contributionActiveFields: input.contributionActiveFields,
        })
        .returning();
      return rows[0]!;
    }),

  /**
   * Clone an existing profile's contributionActiveFields into a new
   * profile, verbatim. Safe as a straight copy (unlike Salary Profile's
   * extraPaycheckRouting, or Budget Profile's contributionAccountId):
   * contributionActiveFields is a pure value-override map keyed by
   * contributionAccountId (contributionValue/method/match fields/
   * autoMaximize/isActive) with no FK to owned rows and no external
   * write-through path — multiple profiles already reference the same
   * account ids as normal steady state (that's what the compare view
   * renders), so there's no double-counting or sync-conflict hazard here.
   */
  duplicate: contributionProfileProcedure
    .input(
      z.object({
        sourceProfileId: z.number().int(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.sourceProfileId))
        .then((r) => r[0]);
      if (!source) throw new Error("Source profile not found");

      const contributionActiveFields = source.contributionActiveFields ?? {};
      await assertNoJointPercentOfSalaryWithoutJob(
        ctx.db,
        contributionActiveFields,
      );

      const rows = await ctx.db
        .insert(schema.contributionProfiles)
        .values({
          name: input.name,
          description: source.description,
          contributionActiveFields,
        })
        .returning();
      return rows[0]!;
    }),

  /**
   * Update an existing contribution profile.
   */
  update: contributionProfileProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).nullish(),
        contributionActiveFields: ContributionActiveFieldsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      if (!existing[0]) throw new Error("Profile not found");

      await assertNoJointPercentOfSalaryWithoutJob(
        ctx.db,
        input.contributionActiveFields,
      );

      const updates: Partial<typeof schema.contributionProfiles.$inferInsert> =
        {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description ?? null;
      if (input.contributionActiveFields !== undefined)
        updates.contributionActiveFields = input.contributionActiveFields;

      const rows = await ctx.db
        .update(schema.contributionProfiles)
        .set(updates)
        .where(eq(schema.contributionProfiles.id, input.id))
        .returning();
      return rows[0]!;
    }),

  /**
   * Patch (merge) one account's active fields within a profile — a true
   * field-level patch, not a client-side-merged full-blob replace. `fields`
   * only needs to carry the keys actually changing; `unset` explicitly
   * names keys to remove (a JSON body can't transmit `undefined` as a
   * distinguishable value from "key omitted", so field-level deletion
   * needs its own signal). Keys not mentioned in either are left untouched.
   *
   * The read-merge-write happens inside a transaction so two overlapping
   * patches to the same profile (two fields committed in quick succession,
   * a second tab/device) can't silently clobber each other the way the
   * previous design — read a snapshot client-side, merge client-side, PUT
   * the whole blob back — could.
   *
   * `fields` is validated against the loose per-field patch schema (every
   * field optional, no cross-field constraint); the paired-or-neither
   * contributionValue/contributionMethod invariant is checked on the
   * MERGED result below, not on the patch itself, since a legitimate
   * single-field patch (e.g. just `{ isActive: false }`) must not be
   * rejected for not also carrying an unrelated pair.
   */
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
          throw new Error(
            "Joint accounts using percent-of-salary contributions must be linked to a specific job",
          );
        }
      }

      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, input.profileId));
        const profile = existing[0];
        if (!profile) throw new Error("Profile not found");

        const root = profile.contributionActiveFields as {
          contributionAccounts?: Record<string, Record<string, unknown>>;
        };
        const mergedEntry: Record<string, unknown> = {
          ...root.contributionAccounts?.[String(input.accountId)],
        };
        for (const key of input.unset ?? []) delete mergedEntry[key];
        Object.assign(mergedEntry, input.fields);

        const parsed = contribAccountActiveFieldsSchema.safeParse(mergedEntry);
        if (!parsed.success) {
          throw new Error(
            `Invalid contribution account fields after patch: ${parsed.error.issues[0]?.message}`,
          );
        }

        // A fully-unset entry is removed entirely, not stored as `{}` — an
        // absent key and an empty object mean the same thing here
        // (getIncompleteContribAccountIds treats them identically), but
        // only one of them should be the actual on-disk representation.
        const nextAccounts = { ...root.contributionAccounts };
        if (Object.keys(parsed.data).length === 0) {
          delete nextAccounts[String(input.accountId)];
        } else {
          nextAccounts[String(input.accountId)] = parsed.data;
        }
        const nextActiveFields = {
          ...root,
          contributionAccounts: nextAccounts,
        };

        const rows = await tx
          .update(schema.contributionProfiles)
          .set({
            contributionActiveFields:
              nextActiveFields as typeof profile.contributionActiveFields,
          })
          .where(eq(schema.contributionProfiles.id, input.profileId))
          .returning();
        return rows[0]!;
      });
    }),

  /**
   * Patch (merge) one deduction's active amount within a profile — same
   * field-level-patch, same-transaction pattern as setAccountActiveFields.
   * A deduction has no live amountPerPeriod any more (Stage B dropped the
   * column) — this is the only way to give one a resolvable value.
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
      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, input.profileId));
        const profile = existing[0];
        if (!profile) throw new Error("Profile not found");

        const root = profile.contributionActiveFields as {
          contributionAccounts?: Record<string, Record<string, unknown>>;
          deductions?: Record<string, Record<string, unknown>>;
        };
        const mergedEntry: Record<string, unknown> = {
          ...root.deductions?.[String(input.deductionId)],
        };
        for (const key of input.unset ?? []) delete mergedEntry[key];
        Object.assign(mergedEntry, input.fields);

        const parsed = deductionActiveFieldsSchema.safeParse(mergedEntry);
        if (!parsed.success) {
          throw new Error(
            `Invalid deduction fields after patch: ${parsed.error.issues[0]?.message}`,
          );
        }

        const nextDeductions = { ...root.deductions };
        if (Object.keys(parsed.data).length === 0) {
          delete nextDeductions[String(input.deductionId)];
        } else {
          nextDeductions[String(input.deductionId)] = parsed.data;
        }
        const nextActiveFields = {
          ...root,
          deductions: nextDeductions,
        };

        const rows = await tx
          .update(schema.contributionProfiles)
          .set({
            contributionActiveFields:
              nextActiveFields as typeof profile.contributionActiveFields,
          })
          .where(eq(schema.contributionProfiles.id, input.profileId))
          .returning();
        return rows[0]!;
      });
    }),

  /**
   * Delete a contribution profile. Blocked when it's the last one left (the
   * active-profile setting must always resolve to a real row), when it's the
   * globally-active selection, and when any Plan still pins it — the
   * scenarios FK is `set null`, so without that check deleting would silently
   * unpin every Plan referencing it. (Mirrors salaryProfile.delete, which had
   * the Plan-pin guard first.)
   */
  delete: contributionProfileProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const activeSettingRows = await ctx.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, SK_ACTIVE_CONTRIB_PROFILE_ID));
      const activeId = (activeSettingRows[0]?.value ?? null) as number | null;

      const allProfiles = await ctx.db
        .select({ id: schema.contributionProfiles.id })
        .from(schema.contributionProfiles);

      const deleteCheck = canDeleteContribProfile(
        activeId,
        input.id,
        allProfiles.length,
      );
      if (!deleteCheck.allowed) throw new Error(deleteCheck.reason);

      if (!allProfiles.some((p) => p.id === input.id))
        throw new Error("Profile not found");

      const pinningPlans = await ctx.db
        .select({ name: schema.scenarios.name })
        .from(schema.scenarios)
        .where(eq(schema.scenarios.contributionProfileId, input.id));
      if (pinningPlans.length > 0) {
        throw new Error(
          `Cannot delete: pinned by ${pinningPlans.length} Plan(s) (${pinningPlans
            .map((p) => p.name)
            .join(", ")}). Unpin it there first.`,
        );
      }

      await ctx.db
        .delete(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      return { success: true };
    }),

  /**
   * Resolve a profile to aggregate totals — used by the relocation tool
   * and any other consumer that needs salary/contribution/match numbers
   * for a given profile.
   */
  resolve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const profiles = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      const profile = profiles[0];
      if (!profile) return null;

      const { contribs, jobs, jobSalaries, salaryProfileActiveMap } =
        await loadLiveContribData(ctx.db);
      const resolved = resolveProfile(
        profile,
        contribs,
        jobs,
        jobSalaries,
        salaryProfileActiveMap,
      );
      const agg = aggregateContributionsByCategory(
        resolved.activeContribs,
        resolved.activeJobs,
        resolved.jobSalaries,
      );

      const totalContributions = Object.values(agg.contribByCategory).reduce(
        (sum, cat) => sum + cat.annual,
        0,
      );
      const totalMatch = Object.values(agg.employerMatchByCategory).reduce(
        (sum, val) => sum + val,
        0,
      );

      return {
        combinedSalary: resolved.combinedSalary,
        annualContributions: totalContributions,
        annualEmployerMatch: totalMatch,
        contribByCategory: agg.contribByCategory,
        employerMatchByCategory: agg.employerMatchByCategory,
      };
    }),
});
