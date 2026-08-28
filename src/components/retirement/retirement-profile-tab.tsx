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

import { useMemo, useCallback } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { Card } from "@/components/ui/card";
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
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveContribProfile } from "@/lib/hooks/use-active-contrib-profile";
import { useActiveSalaryProfile } from "@/lib/hooks/use-active-salary-profile";
import { useEffectiveProfileId } from "@/lib/hooks/use-effective-profile-id";
import { useScenario } from "@/lib/context/scenario-context";
import { StrategyGuideButton } from "@/components/cards/strategy-guide-panel";
import { CardBoundary } from "@/components/cards/dashboard/utils";

export function RetirementProfileTab() {
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
    }),
    [
      salaryActiveFields,
      effectiveContribProfileId,
      effectiveSalaryProfileId,
      decBudgetProfileId,
      decBudgetCol,
      decExpenseOverride,
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
    },
  });
  // Same TypeScript inference gap as the Retirement page had — tRPC's
  // inferred input uses the specific withdrawalStrategy enum union and omits
  // null from optional strategy fields; our Settings layer mirrors the raw
  // DB shape (string / string|null). buildSettingsPatch only ever sends
  // fields Zod accepts.
  const upsertSettingsMutation =
    upsertSettings as unknown as UpsertSettingsMutation; // eslint-disable-line no-restricted-syntax

  const handleRetirementSettingUpdate = useCallback(
    (field: string, value: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings) return;
      const numVal = parseInt(value, 10);
      if (isNaN(numVal)) return;
      upsertSettings.mutate({
        personId: settings.personId,
        retirementAge: settings.retirementAge,
        endAge: settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
        [field]: numVal,
      });
    },
    [data, upsertSettings],
  );

  const handleSettingPercentUpdate = useCallback(
    (field: string, wholePercent: string) => {
      const settings = data && "settings" in data ? data.settings : null;
      if (!settings) return;
      const dec = wholeToDec(wholePercent);
      upsertSettings.mutate({
        personId: settings.personId,
        retirementAge: settings.retirementAge,
        endAge: settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
        [field]: dec,
      });
    },
    [data, upsertSettings],
  );

  const handlePerPersonRetirementAge = useCallback(
    (personId: number, newAge: number) => {
      const settings = data && "settings" in data ? data.settings : null;
      const perPersonSettings =
        data && "perPersonSettings" in data ? data.perPersonSettings : null;
      if (!settings || isNaN(newAge)) return;
      const ps = perPersonSettings?.find(
        (p: { personId: number }) => p.personId === personId,
      );
      upsertSettings.mutate({
        personId,
        retirementAge: newAge,
        endAge: ps?.endAge ?? settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
      });
    },
    [data, upsertSettings],
  );

  const handlePerPersonRuleOf55Override = useCallback(
    (personId: number, ruleOf55Override: boolean) => {
      const settings = data && "settings" in data ? data.settings : null;
      const perPersonSettings =
        data && "perPersonSettings" in data ? data.perPersonSettings : null;
      if (!settings) return;
      const ps = perPersonSettings?.find(
        (p: { personId: number }) => p.personId === personId,
      );
      upsertSettings.mutate({
        personId,
        retirementAge: ps?.retirementAge ?? settings.retirementAge,
        endAge: ps?.endAge ?? settings.endAge,
        returnAfterRetirement: settings.returnAfterRetirement,
        annualInflation: settings.annualInflation,
        salaryAnnualIncrease: settings.salaryAnnualIncrease,
        ruleOf55Override,
      });
    },
    [data, upsertSettings],
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
                combinedSalary={data.combinedSalary}
                people={data.people}
                salaryByPerson={data.salaryByPerson}
                upsertSettings={upsertSettingsMutation}
                handleSettingPercentUpdate={handleSettingPercentUpdate}
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
                <span className="text-micro text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded font-medium">
                  Baseline + Simulation
                </span>
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
                        upsertSettings.mutate({
                          personId: settings.personId,
                          retirementAge: settings.retirementAge,
                          endAge: settings.endAge,
                          returnAfterRetirement: settings.returnAfterRetirement,
                          annualInflation: settings.annualInflation,
                          salaryAnnualIncrease: settings.salaryAnnualIncrease,
                          withdrawalStrategy: e.target
                            .value as WithdrawalStrategyType,
                        });
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
              <span className="text-micro text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded">
                Baseline
              </span>
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
              upsertSettings={upsertSettingsMutation}
              isEditable={admin}
            />

            <TaxesSection
              settings={settings}
              selectedScenario={selectedScenario}
              upsertSettings={upsertSettingsMutation}
              isEditable={admin}
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
