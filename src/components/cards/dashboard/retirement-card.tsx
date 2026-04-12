import { memo } from "react";
("use client");

import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { useSalaryOverrides } from "@/lib/hooks/use-salary-overrides";
import {
  categoriesWithIrsLimit,
  getLimitGroup,
} from "@/lib/config/account-types";
import { WITHDRAWAL_STRATEGY_LABELS } from "@/lib/config/withdrawal-strategies";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import { LoadingCard, ErrorCard } from "./utils";

function RetirementCardImpl() {
  const salaryOverrides = useSalaryOverrides();
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
    ...(salaryOverrides.length > 0 ? { salaryOverrides } : {}),
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
  const { data, isLoading, error } =
    trpc.projection.computeProjection.useQuery(engineInput);
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
  const retPortfolio = portfolioByTaxTypeByParentCat?.["Retirement"];
  const retAge = settings.retirementAge;
  const endAge = settings.endAge;
  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const portfolioTotal = retPortfolio
    ? retPortfolio.preTax +
      retPortfolio.taxFree +
      retPortfolio.hsa +
      retPortfolio.afterTax
    : 0;
  const annualContributions = Object.values(
    realDefaults.annualByCategory,
  ).reduce((s, v) => s + v, 0);
  const employerContributions = Object.values(
    realDefaults.employerMatchByCategory,
  ).reduce((s, v) => s + v, 0);
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
            <span className="text-[10px] text-faint">
              (age {currentAge} → {retAge})
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Retirement accounts</span>
          <span className="text-primary">{formatCurrency(portfolioTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Contributions</span>
          <span className="text-primary">
            {formatCurrency(totalWithMatch)}/yr
            {employerContributions > 0 && (
              <span className="text-[10px] text-faint ml-1">
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
              | string
              | undefined;
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
                        : "Your projected nest egg × withdrawal rate in today's dollars. Does not account for volatility or taxes — see Monte Carlo on the Retirement page for a realistic range."
                    }
                    learnMoreHref="/retirement/decumulation-methodology"
                  />
                </span>
                <span className="text-primary">
                  {formatCurrency(sustainableWd)}/yr
                  <span className="text-[10px] text-faint ml-1">
                    ({strategyLabel}
                    {isDynamic ? ", varies" : ""})
                  </span>
                </span>
              </div>
            );
          })()}
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
