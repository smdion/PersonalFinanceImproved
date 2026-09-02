"use client";

/**
 * Retirement Profile tab panel — the "Projection Assumptions" card, moved
 * off the Retirement page onto the Budget page in v0.7.8 (PLAN-v0.7.8-v4
 * Group A). Straight relocation of a singleton settings editor, not a new
 * profile type: `retirement_settings` still has no name/multi-row shape,
 * still reads/writes through `retirementSettings.upsert` and
 * `computeProjection`'s `metadataOnly` response exactly as it did on the
 * Retirement page. This component owns that data-fetching independently
 * (its own `computeProjection` query, its own persisted-setting state)
 * rather than threading it through `budget-content.tsx`'s existing
 * `budget.computeActiveSummary` query, which is a different shape entirely.
 *
 * The decumulation-budget persisted-setting keys
 * (`retirement_dec_budget_profile_id` / `retirement_decumulation_budget_column`
 * / `retirement_dec_expense_override`) are unchanged from the Retirement
 * page — they're read from `app_settings` (server-side, cross-page), so the
 * Retirement page's `ProjectionCard` (which stayed put) keeps reading the
 * same values this tab writes.
 *
 * Edit controls are gated on `isAdmin(user)` (RULES.md §Permission rule 1 —
 * `retirementSettings.upsert` is `adminProcedure`), carried over unchanged
 * from the Retirement-page fix (Group B).
 */

import { useMemo, useCallback, useRef } from "react";
import { toast } from "@/lib/hooks/use-toast";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatPercent } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import {
  getAllStrategyKeys,
  getStrategyMeta,
} from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { recommendWithdrawalStrategy } from "@/lib/pure/withdrawal-strategy-recommendation";
import { SocialSecuritySection } from "@/components/retirement/sections/social-security";
import { TaxesSection } from "@/components/retirement/sections/taxes";
import { HealthcareSection } from "@/components/retirement/sections/healthcare";
import { RmdHandlingSection } from "@/components/retirement/sections/rmd-handling";
import { GlidePathSection } from "@/components/retirement/sections/glide-path";
import { TimelineSection } from "@/components/retirement/sections/timeline";
import { IncomeSection } from "@/components/retirement/sections/income";
import { StrategyParamsSection } from "@/components/retirement/sections/strategy-params";
import { PerPhaseBudgetSection } from "@/components/retirement/sections/per-phase-budget";
import { RaiseAndRateSection } from "@/components/retirement/sections/raise-and-rate";
import type { UpsertSettingsMutation } from "@/components/retirement/sections/types";
import {
  decToWhole,
  wholeToDec,
} from "@/components/retirement/sections/helpers";
import { buildSettingsPatch } from "@/components/retirement/sections/settings-patch";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useScenario } from "@/lib/context/scenario-context";
import { StrategyGuideButton } from "@/components/cards/strategy-guide-panel";
import { CardBoundary } from "@/components/cards/dashboard/utils";

export function RetirementProfileTab({
  profileId,
}: {
  /** View a specific retirement profile without it needing to be the
   *  household's globally-active one — same "view without activating"
   *  contract contributionProfileId/salaryProfileId already have on
   *  computeProjection (phase 4 of the Retirement Profiles migration).
   *  Omit to fall back to the active profile (server-side resolution),
   *  matching this component's original behavior before it had a sibling
   *  list to view non-active profiles from. */
  profileId?: number | null;
} = {}) {
  const currentYear = new Date().getFullYear();
  const user = useUser();
  const admin = isAdmin(user);
  const utils = trpc.useUtils();
  const salaryActiveFields = useActiveSalaries();
  const [decBudgetProfileId, setDecBudgetProfileId] = usePersistedSetting<
    number | null
  >("retirement_dec_budget_profile_id", null);
  const [decBudgetCol, setDecBudgetCol] = usePersistedSetting<number | null>(
    "retirement_decumulation_budget_column",
    null,
  );
  const [decExpenseOverride, setDecExpenseOverride] = usePersistedSetting<
    string | null
  >("retirement_dec_expense_override", null);
  const [contribProfileId, setContribProfileId] = useActiveContribProfile();
  const contribProfilesQuery = trpc.contributionProfile.list.useQuery();
  const contribProfiles = contribProfilesQuery.data ?? [];
  const [salaryProfileId, setSalaryProfileId] = useActiveSalaryProfile();
  const salaryProfilesQuery = trpc.salaryProfile.list.useQuery();
  const salaryProfiles = salaryProfilesQuery.data ?? [];

  const { activeScenario } = useScenario();
  const { profileId: effectiveContribProfileId, isPinned: isContribPinned } =
    useEffectiveProfileId("contribution", {
      validIds: contribProfiles.map((p) => p.id),
      localSelection: null,
      globalDefaultId: contribProfileId,
    });
  const { profileId: effectiveSalaryProfileId, isPinned: isSalaryPinned } =
    useEffectiveProfileId("salary", {
      validIds: salaryProfiles.map((p) => p.id),
      localSelection: null,
      globalDefaultId: salaryProfileId,
    });

  // No snapshot selector on this tab (that stayed with ProjectionCard on the
  // Retirement page) — settings/perPersonSettings/budgetProfileSummaries
  // don't depend on which portfolio snapshot is selected.
  const baseInput = useMemo(
    () => ({
      ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
      ...(effectiveContribProfileId != null
        ? { contributionProfileId: effectiveContribProfileId }
        : {}),
      ...(effectiveSalaryProfileId != null
        ? { salaryProfileId: effectiveSalaryProfileId }
        : {}),
      ...(decBudgetProfileId != null
        ? { decumulationBudgetProfileId: decBudgetProfileId }
        : {}),
      ...(decBudgetCol != null
        ? { decumulationBudgetColumn: decBudgetCol }
        : {}),
      ...(decExpenseOverride
        ? { decumulationExpenseOverride: parseFloat(decExpenseOverride) }
        : {}),
      ...(profileId != null ? { retirementProfileId: profileId } : {}),
    }),
    [
      salaryActiveFields,
      effectiveContribProfileId,
      effectiveSalaryProfileId,
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
      profileId,
    ],
  );
  const engineInput = useMemo(
    () => ({ metadataOnly: true as const, ...baseInput }),
    [baseInput],
  );
  const debouncedEngineInput = useDebouncedValue(engineInput, 600);
  const { data, isLoading, error } = trpc.projection.computeProjection.useQuery(
    debouncedEngineInput,
    { placeholderData: (prev) => prev },
  );
  // Multi-year withdrawal-policy optimizer, Phase 4 (2026-08-29) — queried
  // here (not inside TaxesSection, a documented pure-presentational leaf)
  // so it can be passed down as a plain prop, same pattern as CoastFireCard
  // receiving coastFireMcResult. Queried with `{}` — this tab reflects the
  // household's persisted baseline settings, not a scenario-override
  // projection, so there are no accumulation/decumulation overrides to
  // thread through. staleTime of a few minutes (not `staleTime: 0` +
  // refetchOnMount: "always"): a household's balances don't meaningfully
  // change mid-session, matching plan-health.tsx's stress-test query
  // precedent — explicit, not left to the query library's default (which
  // would otherwise silently serve a possibly-very-stale cached response
  // on remount). See PLAN-v0.7.10-multi-year-withdrawal-optimizer.md.
  const bracketOptimizerQuery =
    trpc.projection.computeWithdrawalBracketOptimizer.useQuery(
      {},
      { staleTime: 5 * 60 * 1000 },
    );
  // This tab holds many separate InlineEdit fields (Timeline, Rule of 55,
  // Raise-and-Rate, Strategy Params, SS, Taxes, Healthcare), but they all
  // funnel through this ONE upsertSettings mutation, called once per field
  // as the household edits. Nothing on THIS page ever shows a recompute is
  // happening — the Retirement page's ProjectionCard (where the actual
  // recalculation UI lives) isn't mounted here, so utils.projection.
  // invalidate() above just marks the data stale for next time, silently
  // (live-user finding, 2026-08-30: "does it wait till the portfolio page
  // is reloaded?" — yes, and there was no confirmation it even queued).
  // Debounced so a quick burst of edits (several fields in a row) collapses
  // into ONE toast after saves settle, not one per field.
  const recalcToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyRecalcQueued = useCallback(() => {
    if (recalcToastTimer.current) clearTimeout(recalcToastTimer.current);
    recalcToastTimer.current = setTimeout(() => {
      recalcToastTimer.current = null;
      toast.info(
        "Retirement settings updated — your projection will recalculate next time you view it.",
      );
    }, 1000);
  }, []);

  // Per-person / household-but-per-person-stored fields (Retirement Age,
  // Rule of 55, Plan Through, SS Start Age, SS Benefit) write through these
  // two mutations, NOT retirementSettings.upsert — build-engine-payload.ts
  // reads them from `retirement_profile_people`, not `retirement_settings`,
  // as of the Retirement Profiles migration step B. See
  // retirementProfilePeople.upsertPerson's docblock (retirement.ts).
  const upsertProfilePerson =
    trpc.retirement.retirementProfilePeople.upsertPerson.useMutation({
      onSuccess: () => {
        utils.retirement.invalidate();
        utils.projection.invalidate();
        notifyRecalcQueued();
      },
    });
  const upsertProfileHouseholdFields =
    trpc.retirement.retirementProfilePeople.upsertHouseholdFields.useMutation({
      onSuccess: () => {
        utils.retirement.invalidate();
        utils.projection.invalidate();
        notifyRecalcQueued();
      },
    });

  // R53 — per-person "Pre-Retirement Raise". Writes only
  // retirement_settings.salary_annual_increase for one (profile, person).
  const upsertPersonRaiseRate =
    trpc.retirement.retirementSettings.upsertPersonRaiseRate.useMutation({
      onSuccess: () => {
        utils.retirement.invalidate();
        utils.projection.invalidate();
        notifyRecalcQueued();
      },
    });

  const upsertSettings = trpc.retirement.retirementSettings.upsert.useMutation({
    onMutate: async (newSettings) => {
      await utils.projection.computeProjection.cancel();
      const defined = Object.fromEntries(
        Object.entries(newSettings).filter(([, v]) => v !== undefined),
      );
      utils.projection.computeProjection.setData(
        debouncedEngineInput,
        (old) => {
          if (!old || !("settings" in old) || !old.settings) return old;
          return {
            ...old,
            settings: { ...old.settings, ...defined },
          } as typeof old;
        },
      );
    },
    onSuccess: () => {
      utils.retirement.invalidate();
      utils.projection.invalidate();
      notifyRecalcQueued();
    },
  });
  // Same TypeScript inference gap as the Retirement page had — tRPC's
  // inferred input uses the specific withdrawalStrategy enum union and omits
  // null from optional strategy fields; our Settings layer mirrors the raw
  // DB shape (string / string|null). buildSettingsPatch only ever sends
  // fields Zod accepts.
  const upsertSettingsMutation =
    upsertSettings as unknown as UpsertSettingsMutation; // eslint-disable-line no-restricted-syntax

  // Only ever called with "retirementAge" (single-person household) or
  // "endAge" ("Plan Through") — both per-person-stored fields on
  // `retirement_profile_people`, not `retirement_settings`. See the
  // mutations' docblocks for why this can't go through upsertSettings.
  const handleRetirementSettingUpdate = useCallback(
    (field: string, value: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings || settings.profileId == null) return;
      const numVal = parseInt(value, 10);
      if (isNaN(numVal)) return;
      if (field === "endAge") {
        upsertProfileHouseholdFields.mutate({
          profileId: settings.profileId,
          endAge: numVal,
        });
        return;
      }
      if (field === "retirementAge") {
        upsertProfilePerson.mutate({
          profileId: settings.profileId,
          personId: settings.personId,
          retirementAge: numVal,
        });
        return;
      }
    },
    [data, upsertProfileHouseholdFields, upsertProfilePerson],
  );

  const handleSettingPercentUpdate = useCallback(
    (field: string, wholePercent: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings) return;
      const dec = wholeToDec(wholePercent);
      upsertSettingsMutation.mutate(
        buildSettingsPatch(settings, { [field]: dec }),
      );
    },
    [data, upsertSettingsMutation],
  );

  const handlePerPersonRetirementAge = useCallback(
    (personId: number, newAge: number) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings || settings.profileId == null || isNaN(newAge)) return;
      upsertProfilePerson.mutate({
        profileId: settings.profileId,
        personId,
        retirementAge: newAge,
      });
    },
    [data, upsertProfilePerson],
  );

  const handlePerPersonRuleOf55Override = useCallback(
    (personId: number, ruleOf55Override: boolean) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings || settings.profileId == null) return;
      upsertProfilePerson.mutate({
        profileId: settings.profileId,
        personId,
        ruleOf55Override,
      });
    },
    [data, upsertProfilePerson],
  );

  const handlePerPersonRaiseRate = useCallback(
    (personId: number, wholePercent: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings || settings.profileId == null) return;
      upsertPersonRaiseRate.mutate({
        profileId: settings.profileId,
        personId,
        salaryAnnualIncrease: wholeToDec(wholePercent),
      });
    },
    [data, upsertPersonRaiseRate],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
          <SkeletonChart height={128} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load retirement profile: {error.message}
      </p>
    );
  }

  if (!data || !("settings" in data)) {
    return (
      <EmptyState
        message="No retirement data available."
        hint="Configure retirement settings (age, return rates, contribution strategy) in Settings to see projections."
      />
    );
  }

  const { settings, returnRateSummary, perPersonSettings, selectedScenario } =
    data;

  return (
    <CardBoundary title="Projection Assumptions">
      <Card title="Projection Assumptions" className="mb-6">
        <div className="space-y-4">
          {/* Two-column layout: Timeline+Income (left) | Decumulation Plan (right) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left column: Timeline + Income */}
            <div className="bg-surface-sunken rounded-lg p-3 space-y-4">
              <TimelineSection
                settings={settings}
                currentYear={currentYear}
                perPersonSettings={perPersonSettings}
                handlePerPersonRetirementAge={handlePerPersonRetirementAge}
                handlePerPersonRuleOf55Override={
                  handlePerPersonRuleOf55Override
                }
                handleRetirementSettingUpdate={handleRetirementSettingUpdate}
                isEditable={admin}
              />

              <IncomeSection
                settings={settings}
                perPersonSettings={perPersonSettings}
                combinedSalary={data.combinedSalary}
                people={data.people}
                salaryByPerson={data.salaryByPerson}
                upsertSettings={upsertSettingsMutation}
                handleSettingPercentUpdate={handleSettingPercentUpdate}
                handlePerPersonRaiseRate={handlePerPersonRaiseRate}
                contribProfiles={contribProfiles}
                contribProfileId={contribProfileId}
                setContribProfileId={setContribProfileId}
                isContribPinned={isContribPinned}
                salaryProfiles={salaryProfiles}
                salaryProfileId={salaryProfileId}
                setSalaryProfileId={setSalaryProfileId}
                isSalaryPinned={isSalaryPinned}
                pinnedPlanName={activeScenario?.name}
                isEditable={admin}
              />
            </div>

            {/* Right column: Decumulation Plan */}
            <div className="bg-surface-sunken rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
                  Decumulation Plan
                </h4>
                <Badge color="indigo">Baseline + Simulation</Badge>
                <div className="flex-1 border-t" />
                <StrategyGuideButton />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 text-sm">
                <div className="col-span-2">
                  <span className="text-muted">
                    Strategy
                    <HelpTip text="How annual spending is determined during retirement. Fixed Real: perfectly predictable income that never changes based on market performance. Dynamic strategies (all others) automatically adjust spending when your portfolio rises or falls — this protects against depletion (higher success rates) but means your income varies year to year. The more a strategy self-corrects, the higher its success rate but the less stable your income. See Full Methodology for detailed guidance on when to use each strategy." />
                  </span>
                  <div className="font-medium">
                    <select
                      value={settings?.withdrawalStrategy ?? "fixed"}
                      onChange={(e) => {
                        if (!settings) return;
                        upsertSettingsMutation.mutate(
                          buildSettingsPatch(settings, {
                            withdrawalStrategy: e.target
                              .value as WithdrawalStrategyType,
                          }),
                        );
                      }}
                      disabled={!admin}
                      className="text-sm border rounded px-1.5 py-0.5 w-full disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {(() => {
                        const rec = recommendWithdrawalStrategy({
                          retirementHorizonYears:
                            settings.endAge - settings.retirementAge,
                          hasBudgetLink: !!data.accumulationBudgetProfileId,
                          hasSocialSecurity:
                            Number(settings.socialSecurityMonthly) > 0,
                          mostlyTaxAdvantaged: false,
                        });
                        return getAllStrategyKeys().map((key) => {
                          const meta = getStrategyMeta(key);
                          const isRecommended = key === rec.strategy;
                          return (
                            <option key={key} value={key}>
                              {isRecommended ? "★ " : ""}
                              {meta.label}
                              {isRecommended ? " — Recommended" : ""}
                            </option>
                          );
                        });
                      })()}
                    </select>
                  </div>
                </div>
                <div>
                  <span className="text-muted text-caption">
                    {(() => {
                      const key = (settings?.withdrawalStrategy ??
                        "fixed") as WithdrawalStrategyType;
                      const meta = getStrategyMeta(key);
                      return meta.description;
                    })()}
                  </span>
                </div>
              </div>

              <PerPhaseBudgetSection
                settings={settings}
                budgetProfileSummaries={data.budgetProfileSummaries}
                decumulationBudgetProfileId={data.decumulationBudgetProfileId}
                decumulationBudgetColumn={data.decumulationBudgetColumn}
                decExpenseOverride={decExpenseOverride}
                setDecExpenseOverride={setDecExpenseOverride}
                setDecBudgetProfileId={setDecBudgetProfileId}
                setDecBudgetCol={setDecBudgetCol}
                isEditable={admin}
              />

              <RaiseAndRateSection
                settings={settings}
                handleSettingPercentUpdate={handleSettingPercentUpdate}
                isEditable={admin}
              />

              <StrategyParamsSection
                settings={settings}
                upsertSettings={upsertSettingsMutation}
                isEditable={admin}
              />
            </div>
          </div>

          {/* Plan Assumptions */}
          <div className="bg-surface-sunken rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-label font-semibold text-muted uppercase tracking-wider">
                Plan Assumptions
              </h4>
              <Badge color="indigo">Baseline</Badge>
              <div className="flex-1 border-t" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="text-muted">
                  Inflation
                  <HelpTip text="Constant CPI rate used for the deterministic projection — expense growth, real-dollar conversions, and IRS limit growth. In simulation mode, this is replaced by the Stochastic Inflation setting from your simulation preset (View Assumptions)." />
                </span>
                <div className="font-medium">
                  <InlineEdit
                    value={decToWhole(settings.annualInflation)}
                    onSave={(v) =>
                      handleSettingPercentUpdate("annualInflation", v)
                    }
                    formatDisplay={(v) => formatPercent(Number(v) / 100, 2)}
                    parseInput={(v) => v.replace(/[^0-9.]/g, "")}
                    type="number"
                    className="text-sm"
                    isEditable={admin}
                  />
                </div>
              </div>
              <div>
                <span className="text-muted">
                  IRS Limit Growth
                  <HelpTip text="Annual increase in 401k/IRA/HSA contribution limits. Historically ~2%/yr." />
                </span>
                <div className="font-medium text-muted">~2%/yr</div>
              </div>
            </div>
          </div>
          {/* Advanced settings */}
          <>
            <SocialSecuritySection
              settings={settings}
              perPersonSettings={perPersonSettings}
              upsertPerson={upsertProfilePerson}
              upsertHouseholdFields={upsertProfileHouseholdFields}
              isEditable={admin}
            />

            <TaxesSection
              settings={settings}
              selectedScenario={selectedScenario}
              upsertSettings={upsertSettingsMutation}
              isEditable={admin}
              bracketOptimizerResult={bracketOptimizerQuery.data?.result}
            />

            <HealthcareSection
              settings={settings}
              upsertSettings={upsertSettingsMutation}
              isEditable={admin}
            />

            <RmdHandlingSection
              settings={settings}
              upsertSettings={upsertSettingsMutation}
              isEditable={admin}
            />

            <GlidePathSection returnRateSummary={returnRateSummary} />
          </>
        </div>
      </Card>
    </CardBoundary>
  );
}
