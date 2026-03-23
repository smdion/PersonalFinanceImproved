/**
 * Contribution Profiles Router
 *
 * CRUD + resolution for named contribution/salary override profiles.
 * Profiles are managed on the budget page (the what-if control center)
 * and consumed by the relocation tool and potentially the retirement page.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createTRPCRouter } from "../trpc";
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
import {
  contributionOverridesSchema,
  salaryOverridesSchema,
} from "@/lib/db/json-schemas";

// ── Override shape validation (write-only — reads tolerate unexpected fields) ──
// Schemas imported from @/lib/db/json-schemas as centralized schemas.

const ContributionOverridesSchema = contributionOverridesSchema;

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
      const r = resolveProfile(profile, contribs, jobs, jobSalaries);
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
        isDefault: profile.isDefault,
        createdAt: profile.createdAt.toISOString(),
        overrideCount:
          Object.keys(
            (
              profile.contributionOverrides as Record<
                string,
                Record<string, Record<string, unknown>>
              >
            ).contributionAccounts ?? {},
          ).length +
          Object.keys(profile.salaryOverrides as Record<string, number>).length,
        summary: {
          combinedSalary: r.combinedSalary,
          annualContributions: totalContributions,
          annualEmployerMatch: totalMatch,
        },
      };
    });

    // Always ensure a "Live" default profile exists in the response.
    // If no DB row is marked isDefault, synthesize one from current data.
    const hasDefault = resolved.some((p) => p.isDefault);
    if (!hasDefault) {
      const liveAgg = aggregateContributionsByCategory(
        contribs,
        jobs,
        jobSalaries,
      );
      const liveTotalContrib = Object.values(liveAgg.contribByCategory).reduce(
        (sum, cat) => sum + cat.annual,
        0,
      );
      const liveTotalMatch = Object.values(
        liveAgg.employerMatchByCategory,
      ).reduce((sum, val) => sum + val, 0);
      const combinedSalary = jobSalaries.reduce((s, js) => s + js.salary, 0);

      resolved.unshift({
        id: 0,
        name: "Live",
        description: "Current paycheck contributions — no overrides",
        isDefault: true,
        createdAt: new Date().toISOString(),
        overrideCount: 0,
        summary: {
          combinedSalary,
          annualContributions: liveTotalContrib,
          annualEmployerMatch: liveTotalMatch,
        },
      });
    }

    return resolved;
  }),

  /**
   * Get a single profile with fully resolved per-account details.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      // id=0 is the synthetic "Live" profile — no overrides, just current data
      let profile: typeof schema.contributionProfiles.$inferSelect;
      if (input.id === 0) {
        profile = {
          id: 0,
          name: "Live",
          description: "Current paycheck contributions — no overrides",
          isDefault: true,
          salaryOverrides: {},
          contributionOverrides: { contributionAccounts: {}, jobs: {} },
          createdAt: new Date(),
        };
      } else {
        const rows = await ctx.db
          .select()
          .from(schema.contributionProfiles)
          .where(eq(schema.contributionProfiles.id, input.id));
        if (!rows[0]) return null;
        profile = rows[0];
      }

      const {
        contribs,
        jobs,
        jobSalaries,
        rawContribRows,
        peopleMap,
        perfAccountMap,
      } = await loadLiveContribData(ctx.db);
      const resolved = resolveProfile(profile, contribs, jobs, jobSalaries);

      // Build per-account detail for the editor UI
      const contribOverridesRoot = profile.contributionOverrides as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      const contribOverrides = (contribOverridesRoot.contributionAccounts ??
        {}) as Record<string, Record<string, unknown>>;
      const jobOverridesMap = (contribOverridesRoot.jobs ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const salaryOverrides = profile.salaryOverrides as Record<string, number>;

      // Convert perfAccountMap to array for fallback matching
      const allPerfAccounts = Array.from(perfAccountMap.values());

      const accountDetails = rawContribRows.map((row) => {
        const override = contribOverrides[String(row.id)];
        const person = peopleMap.get(row.personId);

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

        const displayNameOvr = override?.displayNameOverride as
          | string
          | undefined;

        return {
          id: row.id,
          accountType: row.accountType,
          subType: row.subType,
          label: row.label,
          accountName: displayNameOvr || disambiguatedName,
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
          // Override values (null = no override)
          overrides: override ?? null,
        };
      });

      const salaryDetails = jobs.map((j) => {
        const person = peopleMap.get(j.personId);
        const currentSalary =
          jobSalaries.find((js) => js.job.id === j.id)?.salary ??
          toNumber(j.annualSalary);
        const estimatedBonus = computeBonusGross(
          currentSalary,
          j.bonusPercent,
          j.bonusMultiplier,
          j.bonusOverride,
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
          overrideSalary: salaryOverrides[String(j.personId)] ?? null,
          // Bonus live values
          liveBonusPercent: j.bonusPercent,
          liveBonusMultiplier: j.bonusMultiplier,
          liveBonusOverride: j.bonusOverride,
          liveMonthsInBonusYear: j.monthsInBonusYear,
          liveInclude401kInBonus: j.include401kInBonus,
          liveIncludeBonusInContributions: j.includeBonusInContributions,
          // Job overrides from profile
          jobOverrides: jobOverridesMap[String(j.id)] ?? null,
          employerNameOverride:
            (jobOverridesMap[String(j.id)]?.employerName as
              | string
              | undefined) ?? null,
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
        salaryOverrides: salaryOverridesSchema.default({}),
        contributionOverrides: ContributionOverridesSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .insert(schema.contributionProfiles)
        .values({
          name: input.name,
          description: input.description ?? null,
          salaryOverrides: input.salaryOverrides,
          contributionOverrides: input.contributionOverrides,
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
        salaryOverrides: salaryOverridesSchema.optional(),
        contributionOverrides: ContributionOverridesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Prevent editing the default profile's core identity
      const existing = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      if (!existing[0]) throw new Error("Profile not found");
      if (
        existing[0].isDefault &&
        (input.salaryOverrides || input.contributionOverrides)
      ) {
        throw new Error("Cannot modify the default (Live) profile overrides");
      }

      const updates: Partial<typeof schema.contributionProfiles.$inferInsert> =
        {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined)
        updates.description = input.description ?? null;
      if (input.salaryOverrides !== undefined)
        updates.salaryOverrides = input.salaryOverrides;
      if (input.contributionOverrides !== undefined)
        updates.contributionOverrides = input.contributionOverrides;

      const rows = await ctx.db
        .update(schema.contributionProfiles)
        .set(updates)
        .where(eq(schema.contributionProfiles.id, input.id))
        .returning();
      return rows[0]!;
    }),

  /**
   * Delete a contribution profile (cannot delete default).
   */
  delete: contributionProfileProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(schema.contributionProfiles)
        .where(eq(schema.contributionProfiles.id, input.id));
      if (!existing[0]) throw new Error("Profile not found");
      if (existing[0].isDefault)
        throw new Error("Cannot delete the default (Live) profile");

      // Prevent deleting the currently active profile
      const activeSettingRows = await ctx.db
        .select()
        .from(schema.appSettings)
        .where(eq(schema.appSettings.key, "active_contrib_profile_id"));
      const activeId = activeSettingRows[0]?.value as number | null;
      if (activeId === input.id) {
        throw new Error(
          "Cannot delete the active profile. Switch to a different profile first.",
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
      const resolved = resolveProfile(profile, contribs, jobs, jobSalaries);
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
