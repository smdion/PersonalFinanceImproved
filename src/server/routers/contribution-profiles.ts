/**
 * Contribution Profiles Router
 *
 * CRUD + resolution for named contribution profiles.
 * Profiles are managed on the budget page (the what-if control center)
 * and consumed by the relocation tool and potentially the retirement page.
 *
 * Salary is NOT part of a Contribution Profile — it lives on the independent
 * salaryProfile router. Every resolveProfile() call here therefore passes an
 * empty salary-entry map: these endpoints resolve the contribution axis
 * standalone, not paired with any particular Salary Profile.
 *
 * There is no `isDefault` flag and no synthetic id-0 "Live" row: every
 * profile is an ordinary, renamable, editable row, and one with empty
 * contributionActiveFields is simply a profile with nothing customized.
 */
import { z } from "zod/v4";
import { eq } from "drizzle-orm";
import { createTRPCRouter } from "../trpc";
import { canDeleteContribProfile } from "@/lib/pure/profiles";
import { taxTreatmentToShortLabel } from "@/lib/config/display-labels";
import { protectedProcedure, contributionProfileProcedure } from "../trpc";
import * as schema from "@/lib/db/schema";
import {
  aggregateContributionsByCategory,
  computeBonusGross,
  loadLiveContribData,
  toNumber,
  resolveProfile,
} from "@/server/helpers";
import { accountDisplayName } from "@/lib/utils/format";
import { getDisplayConfig } from "@/lib/config/account-types";
import { contributionActiveFieldsSchema } from "@/lib/db/json-schemas";
import { SK_ACTIVE_CONTRIB_PROFILE_ID } from "@/lib/constants/settings-keys";

// ── Active-field shape validation (write-only — reads tolerate unexpected fields) ──
// Schemas imported from @/lib/db/json-schemas as centralized schemas.

const ContributionActiveFieldsSchema = contributionActiveFieldsSchema;

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
    const { contribs, jobs, jobSalaries } = await loadLiveContribData(ctx.db);

    const resolved = profiles.map((profile) => {
      const r = resolveProfile(profile, {}, contribs, jobs, jobSalaries);
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

      return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        createdAt: profile.createdAt.toISOString(),
        activeFieldCount: Object.keys(
          (
            profile.contributionActiveFields as Record<
              string,
              Record<string, Record<string, unknown>>
            >
          ).contributionAccounts ?? {},
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
      } = await loadLiveContribData(ctx.db);
      const resolved = resolveProfile(profile, {}, contribs, jobs, jobSalaries);

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
      const jobActiveFieldsMap = (contribActiveFieldsRoot.jobs ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
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
          jobs.find((j) => j.personId === row.personId && !j.endDate)
            ?.employerName ??
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
          // Live values
          liveMethod: row.contributionMethod,
          liveValue: row.contributionValue,
          liveMatchType: row.employerMatchType,
          liveMatchValue: row.employerMatchValue,
          liveMaxMatchPct: row.employerMaxMatchPct,
          liveIsActive: row.isActive,
          // Active values (null = inactive, follows the account's own value)
          activeFields: activeFields ?? null,
        };
      });

      const salaryDetails = jobs.map((j) => {
        const person = peopleMap.get(j.personId);
        const matchedSalary = jobSalaries.find((js) => js.job.id === j.id);
        const currentSalary = matchedSalary?.salary ?? toNumber(j.annualSalary);
        const resolvedBonusOverride =
          matchedSalary?.resolvedBonusOverride ?? null;
        // Full formula bonus, ignoring any override — lets the UI show
        // "what would my full bonus be" alongside the pinned/resolved value.
        const fullFormulaBonus = computeBonusGross(
          currentSalary,
          j.bonusPercent,
          j.bonusMultiplier,
          null,
          j.monthsInBonusYear,
        );
        const estimatedBonus = computeBonusGross(
          currentSalary,
          j.bonusPercent,
          j.bonusMultiplier,
          resolvedBonusOverride,
          j.monthsInBonusYear,
        );
        return {
          jobId: j.id,
          personId: j.personId,
          personName: person?.name ?? `Person ${j.personId}`,
          employerName: j.employerName,
          liveSalary: toNumber(j.annualSalary),
          currentSalary,
          estimatedBonus,
          fullFormulaBonus,
          // Bonus live values
          liveBonusPercent: j.bonusPercent,
          liveBonusMultiplier: j.bonusMultiplier,
          liveBonusOverride: resolvedBonusOverride,
          liveMonthsInBonusYear: j.monthsInBonusYear,
          liveInclude401kInBonus: j.include401kInBonus,
          liveIncludeBonusInContributions: j.includeBonusInContributions,
          // Job active fields from profile
          jobActiveFields: jobActiveFieldsMap[String(j.id)] ?? null,
          employerNameActive:
            (jobActiveFieldsMap[String(j.id)]?.employerName as
              string | undefined) ?? null,
        };
      });

      return {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        accountDetails,
        salaryDetails,
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

      const { contribs, jobs, jobSalaries } = await loadLiveContribData(ctx.db);
      const resolved = resolveProfile(profile, {}, contribs, jobs, jobSalaries);
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
