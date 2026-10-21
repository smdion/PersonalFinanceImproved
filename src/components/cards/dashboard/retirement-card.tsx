"use client";

import { assessPlan } from "@/lib/calculators/plan-outcome";
import { memo } from "react";

import { trpc } from "@/lib/trpc";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { DEFAULT_CHECKPOINT_SOURCE } from "@/lib/config/milestones";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import {
  formatCurrency,
  formatPercent,
  formatRelativeTime,
} from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import {
  categoriesWithIrsLimit,
  getLimitGroup,
} from "@/lib/config/account-types";
import { WITHDRAWAL_STRATEGY_LABELS } from "@/lib/config/withdrawal-strategies";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import type { AccountCategory } from "@/lib/config/account-types";
import { filterYearByParentCategory } from "@/components/cards/projection/utils";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { LoadingCard, ErrorCard } from "./utils";
import { RetirementBenchmarks } from "./retirement-benchmarks";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { DEFAULT_HIGH_INCOME_THRESHOLD } from "@/lib/constants";
import { SK_HIGH_INCOME_THRESHOLD } from "@/lib/constants/settings-keys";
import { isHighIncomeHousehold } from "@/lib/pure/contributions";

function RetirementCardImpl() {
  const { engineInput, data, isLoading, error } = useDashboardProjection();
  // The household's checkpoint table and today's figures for Readiness —
  // the same query (and input) the Milestones engine reads.
  const milestoneInputs = trpc.milestones.computeInputs.useQuery(
    useYearEndTargetingInput(),
  );
  const [highIncomeThreshold] = usePersistedSetting<number>(
    SK_HIGH_INCOME_THRESHOLD,
    DEFAULT_HIGH_INCOME_THRESHOLD,
  );
  // The match switch shared with every savings rate and contribution total.
  const { excludeMatch } = useSavingsRateOptions(
    isHighIncomeHousehold(
      data && "combinedSalary" in data ? data.combinedSalary : 0,
      highIncomeThreshold,
    ),
  );
  const { data: coastFireData } = trpc.projection.computeCoastFire.useQuery(
    engineInput,
    {
      staleTime: 60_000,
    },
  );
  // Peek-only reads of the persistent projection cache — never trigger a
  // fresh Monte Carlo run (that's a multi-second, rate-limited operation),
  // just surface whatever the Retirement page's last real run already
  // computed, if the inputs still match. Null result = nothing cached yet.
  const { data: mcPeek } = trpc.projection.computeMonteCarloProjection.useQuery(
    { ...engineInput, peekOnly: true },
    { staleTime: 60_000 },
  );
  const { data: coastFireMcPeek } = trpc.projection.computeCoastFireMC.useQuery(
    { ...engineInput, peekOnly: true },
    { staleTime: 60_000 },
  );
  if (isLoading) return <LoadingCard title="Retirement" />;
  if (error) return <ErrorCard title="Retirement" message="Failed to load" />;
  if (!data?.result)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-faint text-sm">
          Add a person and configure retirement settings to see projections.
        </p>
      </Card>
    );

  const { settings, baseLimits, portfolioByTaxTypeByParentCat } = data;
  // Retirement accounts only, like the Retirement page: the engine projects
  // every account (Portfolio ones too) and pages filter by parent category.
  const result = {
    ...data.result,
    projectionByYear: data.result.projectionByYear.map((yr) =>
      filterYearByParentCategory(yr, PERF_CATEGORY_RETIREMENT),
    ),
  };
  const retirementSpecs = (data.contributionSpecs ?? []).filter(
    (s) => s.parentCategory === PERF_CATEGORY_RETIREMENT,
  );
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
  const annualContributions = sumBy(retirementSpecs, (s) => s.baseAnnual);
  const employerContributions = sumBy(
    retirementSpecs,
    (s) => s.matchAnnual ?? 0,
  );
  // Room is measured against what goes into limited accounts only.
  const limitedContributions = sumBy(
    retirementSpecs.filter((s) =>
      categoriesWithIrsLimit().includes(s.category as AccountCategory),
    ),
    (s) => s.baseAnnual,
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
  // The plan judge: retirement money runs out, or a year falls short.
  const outcome = assessPlan(result);
  // Deflate sustainable withdrawal to today's dollars
  const yearsToRet = Math.max(0, retAge - currentAge);
  const sustainableWdNominal = result.sustainableWithdrawal;
  const sustainableWd =
    yearsToRet > 0 && Number(settings.annualInflation) > 0
      ? sustainableWdNominal /
        Math.pow(1 + Number(settings.annualInflation), yearsToRet)
      : sustainableWdNominal;
  const nestEggNominal =
    result.projectionByYear.find((y) => y.age === retAge)?.retirementBalance ??
    portfolioTotal;
  // Deflate nest egg to today's dollars (same approach as sustainable withdrawal)
  const inflRate = Number(settings.annualInflation) || 0;
  const nestEgg =
    yearsToRet > 0 && inflRate > 0
      ? nestEggNominal / Math.pow(1 + inflRate, yearsToRet)
      : nestEggNominal;
  const totalWithMatch = annualContributions + employerContributions;
  const retirementBudget = data.decumulationExpenses ?? 0;
  const taxAdvSpace =
    retLimits > 0 && limitedContributions < retLimits
      ? retLimits - limitedContributions
      : 0;

  return (
    <Card title="Retirement" href="/retirement">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
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
              <span className="text-primary">
                {formatCurrency(portfolioTotal)}
              </span>
            </div>
            {retPortfolio && portfolioTotal > 0 && (
              <div className="text-faint ml-3 space-y-0.5 text-xs">
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
                {formatCurrency(
                  excludeMatch ? annualContributions : totalWithMatch,
                )}
                /yr
                {employerContributions > 0 && (
                  <span className="text-caption text-faint ml-1">
                    {excludeMatch
                      ? `(+ ${formatCurrency(employerContributions)} match)`
                      : `(${formatCurrency(annualContributions)} + ${formatCurrency(employerContributions)} match)`}
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
            <div className="border-subtle my-1 border-t" />
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
            {coastFireData?.result &&
              (() => {
                const simResult = coastFireMcPeek?.result;
                const simLabel = simResult
                  ? simResult.status === "unreachable"
                    ? "not reachable"
                    : simResult.status === "already_coast"
                      ? "already coast"
                      : `age ${simResult.coastFireAge}`
                  : null;
                return (
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
                        {simLabel
                          ? `(simulated: ${simLabel})`
                          : "(baseline; see Plan Health for simulated)"}
                      </span>
                    </span>
                  </div>
                );
              })()}
            {mcPeek?.result && (
              <div className="flex justify-between">
                <span className="text-muted">
                  Simulated success
                  <HelpTip
                    text="The share of simulated market outcomes in which your plan doesn't run out of money, from the last Simulation you ran on the Retirement page. Not re-run automatically from the dashboard — visit the Retirement page's Plan Health tab to refresh it."
                    learnMoreHref="/retirement"
                  />
                </span>
                <span
                  className={`font-medium ${
                    mcPeek.result.successRate >= 0.9
                      ? STATUS_COLORS.green.text
                      : mcPeek.result.successRate >= 0.75
                        ? STATUS_COLORS.amber.text
                        : STATUS_COLORS.red.text
                  }`}
                >
                  {formatPercent(mcPeek.result.successRate, 0)}
                </span>
              </div>
            )}
            {(() => {
              const lastRunAt = [
                mcPeek && "simulationInputs" in mcPeek
                  ? mcPeek.simulationInputs.computedAt
                  : null,
                coastFireMcPeek?.computedAt,
              ]
                .filter((v): v is string => !!v)
                .sort()
                .at(-1);
              if (!lastRunAt) return null;
              return (
                <div className="flex justify-between">
                  <span className="text-muted">Last simulation run</span>
                  <span className="text-faint">
                    {formatRelativeTime(lastRunAt)}
                  </span>
                </div>
              );
            })()}
            <div className="flex justify-between">
              <span className="text-muted">Duration</span>
              <span
                className={
                  !outcome.succeeded
                    ? "font-medium text-red-600"
                    : "font-medium text-green-600"
                }
              >
                {outcome.succeeded
                  ? `Lasts to ${endAge}+`
                  : outcome.failureReason === "depleted"
                    ? `Runs out age ${outcome.failureAge}`
                    : `Falls short age ${outcome.failureAge}`}
              </span>
            </div>
          </div>
        </div>
        <div className="md:border-subtle md:border-l md:pl-8">
          <RetirementBenchmarks
            data={{ ...data, result }}
            currentAge={currentAge}
            retirementSavings={portfolioTotal}
            checkpoint={{
              source:
                milestoneInputs.data?.checkpointSource ??
                DEFAULT_CHECKPOINT_SOURCE,
              now: milestoneInputs.data?.years.at(-1) ?? null,
              allAccountsByYear: data.result.projectionByYear,
            }}
          />
        </div>
      </div>
    </Card>
  );
}

export const RetirementCard = memo(RetirementCardImpl);
