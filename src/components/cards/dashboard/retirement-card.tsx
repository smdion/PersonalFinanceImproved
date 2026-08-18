"use client";

import { memo, useRef, useEffect } from "react";

import { trpc } from "@/lib/trpc";
import {
  useFICache,
  deriveFI,
  isLivePlanInput,
} from "@/lib/hooks/use-fi-cache";
import { useScenario } from "@/lib/context/scenario-context";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useActiveSalaries } from "@/lib/hooks/use-salary-overrides";
import { useEffectiveSalaryProfileId } from "@/lib/hooks/use-effective-salary-profile-id";
import {
  categoriesWithIrsLimit,
  getLimitGroup,
} from "@/lib/config/account-types";
import { WITHDRAWAL_STRATEGY_LABELS } from "@/lib/config/withdrawal-strategies";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { LoadingCard, ErrorCard } from "./utils";

function RetirementCardImpl() {
  const salaryActiveFields = useActiveSalaries();
  // Contribution/Salary Profile axes — every other dashboard card resolves
  // these before querying (M27, .scratch/docs/review-findings.md: this card
  // used to omit both, which the engine treats as "no profile" = $0
  // contributions, not "the active profile" — silently zeroing out
  // Contributions/Coast FIRE/nest egg on this card alone).
  const [activeContribProfileId] = usePersistedSetting<number | null>(
    "active_contrib_profile_id",
    null,
  );
  const { queryInput: salaryProfileInput } = useEffectiveSalaryProfileId();
  const [accBudgetProfileId] = usePersistedSetting<number | null>(
    "retirement_acc_budget_profile_id",
    null,
  );
  const [accBudgetCol] = usePersistedSetting<number | null>(
    "retirement_accumulation_budget_column",
    null,
  );
  const [decBudgetProfileId] = usePersistedSetting<number | null>(
    "retirement_dec_budget_profile_id",
    null,
  );
  const [decBudgetCol] = usePersistedSetting<number | null>(
    "retirement_decumulation_budget_column",
    null,
  );
  const [accExpenseOverride] = usePersistedSetting<string | null>(
    "retirement_acc_expense_override",
    null,
  );
  const [decExpenseOverride] = usePersistedSetting<string | null>(
    "retirement_dec_expense_override",
    null,
  );
  const engineInput = {
    ...(salaryActiveFields.length > 0 ? { salaryActiveFields } : {}),
    ...(activeContribProfileId != null
      ? { contributionProfileId: activeContribProfileId }
      : {}),
    ...salaryProfileInput,
    ...(accBudgetProfileId != null
      ? { accumulationBudgetProfileId: accBudgetProfileId }
      : {}),
    ...(accBudgetCol != null ? { accumulationBudgetColumn: accBudgetCol } : {}),
    ...(decBudgetProfileId != null
      ? { decumulationBudgetProfileId: decBudgetProfileId }
      : {}),
    ...(decBudgetCol != null ? { decumulationBudgetColumn: decBudgetCol } : {}),
    ...(accExpenseOverride
      ? { accumulationExpenseOverride: parseFloat(accExpenseOverride) }
      : {}),
    ...(decExpenseOverride
      ? { decumulationExpenseOverride: parseFloat(decExpenseOverride) }
      : {}),
  };
  const [, writeFICache] = useFICache();
  const { isInScenario } = useScenario();
  const lastCacheKey = useRef<string | null>(null);

  const { data, isLoading, isFetching, error } =
    trpc.projection.computeProjection.useQuery(engineInput);

  useEffect(() => {
    if (!data?.result || isLoading || isFetching) return;
    // This card never sets snapshot/category-filter/override params (see
    // engineInput above) — only the scenario axis can make this non-live.
    // contributionProfileId/salaryProfileId are always the resolved active
    // profile here, not a preview — see isLivePlanInput's docstring.
    if (!isLivePlanInput({ isInScenario })) return;
    const withdrawalRate = Number(data.settings?.withdrawalRate ?? 0.04);
    const expenses = data.annualExpenses ?? 0;
    if (withdrawalRate <= 0 || expenses <= 0) return;
    const derived = deriveFI(
      data.result.projectionByYear,
      expenses,
      withdrawalRate,
    );
    if (lastCacheKey.current === derived.inputKey) return;
    lastCacheKey.current = derived.inputKey;
    writeFICache({
      fiYear: derived.fiYear,
      fiAge: derived.fiAge,
      inputKey: derived.inputKey,
      computedAt: new Date().toISOString(),
    });
  }, [data, isLoading, isFetching, writeFICache, isInScenario]);
  const { data: coastFireData } = trpc.projection.computeCoastFire.useQuery(
    engineInput,
    {
      staleTime: 60_000,
    },
  );
  if (isLoading) return <LoadingCard title="Retirement" />;
  if (error) return <ErrorCard title="Retirement" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-sm text-faint">
          Add a person and configure retirement settings to see projections.
        </p>
      </Card>
    );

  const {
    result,
    settings,
    baseLimits,
    realDefaults,
    portfolioByTaxTypeByParentCat,
  } = data;
  const retPortfolio =
    portfolioByTaxTypeByParentCat?.[PERF_CATEGORY_RETIREMENT];
  const retAge = settings.retirementAge;
  const endAge = settings.endAge;
  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const portfolioTotal = retPortfolio
    ? retPortfolio.preTax +
      retPortfolio.taxFree +
      retPortfolio.hsa +
      retPortfolio.afterTax
    : 0;
  const annualContributions = sumBy(
    Object.values(realDefaults.annualByCategory),
    (v) => v,
  );
  const employerContributions = sumBy(
    Object.values(realDefaults.employerMatchByCategory),
    (v) => v,
  );
  // Sum limits per unique group (401k/403b share a group — avoid double-counting)
  const retLimits = (() => {
    const seen = new Set<string>();
    let total = 0;
    for (const cat of categoriesWithIrsLimit()) {
      const group = getLimitGroup(cat);
      if (group && !seen.has(group)) {
        seen.add(group);
        total += baseLimits[cat] ?? 0;
      }
    }
    return total;
  })();
  const runsOutYear = result.projectionByYear.find((y) => y.endBalance <= 0);
  // Deflate sustainable withdrawal to today's dollars
  const yearsToRet = Math.max(0, retAge - currentAge);
  const sustainableWdNominal = result.sustainableWithdrawal;
  const sustainableWd =
    yearsToRet > 0 && Number(settings.annualInflation) > 0
      ? sustainableWdNominal /
        Math.pow(1 + Number(settings.annualInflation), yearsToRet)
      : sustainableWdNominal;
  const nestEggNominal =
    result.projectionByYear.find((y) => y.age === retAge)?.endBalance ??
    portfolioTotal;
  // Deflate nest egg to today's dollars (same approach as sustainable withdrawal)
  const inflRate = Number(settings.annualInflation) || 0;
  const nestEgg =
    yearsToRet > 0 && inflRate > 0
      ? nestEggNominal / Math.pow(1 + inflRate, yearsToRet)
      : nestEggNominal;
  const totalWithMatch = annualContributions + employerContributions;
  const retirementBudget = data.decumulationExpenses ?? 0;
  const avgReturn = data.returnRateSummary?.avgAccumulation ?? 0;
  const taxAdvSpace =
    retLimits > 0 && annualContributions < retLimits
      ? retLimits - annualContributions
      : 0;

  return (
    <Card title="Retirement" href="/retirement">
      <Metric
        value={formatCurrency(nestEgg)}
        label={`Nest egg at age ${retAge} (today's $)`}
      />
      <div className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Years to retirement</span>
          <span className="text-primary">
            {yearsToRet} yrs{" "}
            <span className="text-caption text-faint">
              (age {currentAge} → {retAge})
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Retirement accounts</span>
          <span className="text-primary">{formatCurrency(portfolioTotal)}</span>
        </div>
        {retPortfolio && portfolioTotal > 0 && (
          <div className="ml-3 space-y-0.5 text-xs text-faint">
            {retPortfolio.preTax > 0 && (
              <div className="flex justify-between">
                <span>Pre-tax</span>
                <span>{formatCurrency(retPortfolio.preTax)}</span>
              </div>
            )}
            {retPortfolio.taxFree > 0 && (
              <div className="flex justify-between">
                <span>Roth</span>
                <span>{formatCurrency(retPortfolio.taxFree)}</span>
              </div>
            )}
            {retPortfolio.hsa > 0 && (
              <div className="flex justify-between">
                <span>HSA</span>
                <span>{formatCurrency(retPortfolio.hsa)}</span>
              </div>
            )}
            {retPortfolio.afterTax > 0 && (
              <div className="flex justify-between">
                <span>After-tax</span>
                <span>{formatCurrency(retPortfolio.afterTax)}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Contributions</span>
          <span className="text-primary">
            {formatCurrency(totalWithMatch)}/yr
            {employerContributions > 0 && (
              <span className="text-caption text-faint ml-1">
                ({formatCurrency(annualContributions)} +{" "}
                {formatCurrency(employerContributions)} match)
              </span>
            )}
          </span>
        </div>
        {taxAdvSpace > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Tax-advantaged room</span>
            <span className="text-amber-600">
              {formatCurrency(taxAdvSpace)}/yr
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Avg return</span>
          <span className="text-primary">{formatPercent(avgReturn, 1)}</span>
        </div>
        <div className="border-t border-subtle my-1" />
        {retirementBudget > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Retirement budget</span>
            <span className="text-primary">
              {formatCurrency(retirementBudget)}/yr
            </span>
          </div>
        )}
        {sustainableWd > 0 &&
          (() => {
            const strategyKey = settings.withdrawalStrategy as
              string | undefined;
            const strategyLabel = strategyKey
              ? (WITHDRAWAL_STRATEGY_LABELS[
                  strategyKey as WithdrawalStrategyType
                ] ?? strategyKey)
              : "Fixed";
            const isDynamic = strategyKey && strategyKey !== "fixed";
            return (
              <div className="flex justify-between">
                <span className="text-muted">
                  Est. Withdrawal
                  <HelpTip
                    text={
                      isDynamic
                        ? `${strategyLabel} strategy — withdrawal varies year-to-year based on portfolio performance. This is a projected starting amount in today's dollars.`
                        : "Your projected nest egg × withdrawal rate in today's dollars. Does not account for volatility or taxes — see Simulation on the Retirement page for a realistic range."
                    }
                    learnMoreHref="/retirement/decumulation-methodology"
                  />
                </span>
                <span className="text-primary">
                  {formatCurrency(sustainableWd)}/yr
                  <span className="text-caption text-faint ml-1">
                    ({strategyLabel}
                    {isDynamic ? ", varies" : ""})
                  </span>
                </span>
              </div>
            );
          })()}
        {coastFireData?.result && (
          <div className="flex justify-between">
            <span className="text-muted">
              Coast FIRE
              <HelpTip
                text="The earliest age at which you can stop contributing and still fund your plan through end of plan. 'Already Coast' means you could stop today. This is the deterministic baseline — it doesn't account for market variance. The Retirement page's Plan Health tab runs a Simulation and can show a materially later age once you're asking 'stop today, and still succeed in ~90% of simulated outcomes.'"
                learnMoreHref="/retirement"
              />
            </span>
            <span className="text-primary">
              {coastFireData.result.status === "unreachable"
                ? "Not reachable"
                : coastFireData.result.status === "already_coast"
                  ? "Already Coast"
                  : `Age ${coastFireData.result.coastFireAge}`}
              <span className="text-caption text-faint ml-1">
                (baseline; see Plan Health for simulated)
              </span>
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted">Duration</span>
          <span
            className={
              runsOutYear
                ? "text-red-600 font-medium"
                : "text-green-600 font-medium"
            }
          >
            {runsOutYear
              ? `Runs out age ${runsOutYear.age}`
              : `Lasts to ${endAge}+`}
          </span>
        </div>
      </div>
    </Card>
  );
}

export const RetirementCard = memo(RetirementCardImpl);
