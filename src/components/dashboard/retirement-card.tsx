"use client";

import {
  planAgeLabel,
  yearOfPlanAge,
} from "@/lib/pure/household/household-timeline";
import { useHighIncomeLine } from "@/lib/hooks/use-high-income-line";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import {
  baselineNestEgg,
  simulatedOrBaseline,
} from "@/lib/pure/retirement/nest-egg-display";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import { memo } from "react";
import Link from "next/link";
import { settingsHref } from "@/lib/config/settings-sections";
import { NO_RETURN_RATE_MESSAGE } from "@/lib/pure/simulation/return-rate-breakpoints";

import { trpc } from "@/lib/trpc";
import { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { DEFAULT_CHECKPOINT_SOURCE } from "@/lib/config/milestones";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { categoriesWithIrsLimit } from "@/lib/config/account-types";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import type { AccountCategory } from "@/lib/config/account-types";
import { filterYearByParentCategory } from "@/components/retirement-projection/utils";
import { CardQueryBoundary, queryPending } from "./utils";
import { RetirementBenchmarks } from "./retirement-benchmarks";
import {
  renderWithdrawalRow,
  renderCoastFireRow,
  renderLastRunRow,
} from "./retirement-card-rows";
import {
  ContributionsRow,
  DurationRow,
  NestEggFigure,
  RetirementAccountsBreakdown,
  SimulatedSuccessRow,
  TaxRoomRow,
} from "./retirement-card-stats";
import { useSavingsRateOptions } from "@/lib/hooks/use-savings-rate-options";
import { isHighIncomeHousehold } from "@/lib/pure/contributions/savings-rate";

function RetirementCardImpl() {
  const projection = useDashboardProjection();
  const { engineInput, ready, data, gate } = projection;
  // The household's checkpoint table and today's figures for Readiness —
  // the same query (and input) the Milestones engine reads.
  const milestoneInputs = trpc.milestones.computeInputs.useQuery(
    useYearEndTargetingInput(),
  );
  const { threshold: highIncomeThreshold } = useHighIncomeLine();
  // The match switch shared with every savings rate and contribution total.
  const { excludeMatch } = useSavingsRateOptions(
    isHighIncomeHousehold(
      data && "combinedSalary" in data ? data.combinedSalary : 0,
      highIncomeThreshold,
    ),
  );
  const { data: coastFireData } = trpc.projection.computeCoastFire.useQuery(
    engineInput,
    { staleTime: 60_000, enabled: ready },
  );
  // Peek-only reads of the persistent projection cache — never trigger a
  // fresh Monte Carlo run (that's a multi-second, rate-limited operation),
  // just surface whatever the Retirement page's last real run already
  // computed, if the inputs still match. Null result = nothing cached yet.
  const { data: mcPeek } = trpc.projection.peekMonteCarloSummary.useQuery(
    engineInput,
    // Always re-read: a run made on the Retirement page should show here
    // as soon as the dashboard is opened again.
    { staleTime: 0, enabled: ready },
  );
  const { data: coastFireMcPeek } = trpc.projection.computeCoastFireMC.useQuery(
    { ...engineInput, peekOnly: true },
    { staleTime: 0, enabled: ready },
  );
  if (queryPending([projection, gate]))
    return <CardQueryBoundary title="Retirement" query={[projection, gate]} />;
  if (data && "notConfigured" in data)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-faint text-sm">
          {NO_RETURN_RATE_MESSAGE}
          <Link
            href={settingsHref("taxdata", "returns")}
            className="ml-1 underline"
          >
            Set return rates
          </Link>
        </p>
      </Card>
    );
  if (!data?.result)
    return (
      <Card title="Retirement" href="/retirement">
        <p className="text-faint text-sm">
          Add a person and configure retirement settings to see projections.
        </p>
      </Card>
    );

  const { settings, irsGroupLimits, portfolioByTaxTypeByParentCat } = data;
  // Retirement accounts only, like the Retirement page: the engine projects
  // every account (Portfolio ones too) and pages filter by parent category.
  const result = {
    ...data.result,
    projectionByYear: data.result.projectionByYear.map((yr) =>
      filterYearByParentCategory(yr, PERF_CATEGORY_RETIREMENT),
    ),
  };
  const retirementSpecs = data.contributionSpecs.filter(
    (s) => s.parentCategory === PERF_CATEGORY_RETIREMENT,
  );
  const retPortfolio = portfolioByTaxTypeByParentCat[PERF_CATEGORY_RETIREMENT];
  const retAge = settings.retirementAge;
  const endAge = settings.endAge;
  const currentAge = result.projectionByYear[0]?.age ?? 0;
  const firstRow = result.projectionByYear[0] ?? {
    year: new Date().getFullYear(),
    age: currentAge,
  };
  const yearOf = (age: number) => yearOfPlanAge(firstRow, age);
  const ageLabel = (age: number) =>
    planAgeLabel(
      firstRow,
      data.people.find((p) => p.id === data.primaryPersonId)?.name,
      age,
    );
  const portfolioTotal = retPortfolio
    ? retPortfolio.preTax +
      retPortfolio.taxFree +
      retPortfolio.hsa +
      retPortfolio.afterTax
    : 0;
  const annualContributions = sumBy(retirementSpecs, (s) => s.baseAnnual);
  const employerContributions = sumBy(retirementSpecs, (s) => s.matchAnnual);
  // Room is measured against what goes into limited accounts only.
  const limitedContributions = sumBy(
    retirementSpecs.filter((s) =>
      categoriesWithIrsLimit().includes(s.category as AccountCategory),
    ),
    (s) => s.baseAnnual,
  );
  // The household's limits, each shared limit counted once.
  const retLimits = sumBy(Object.values(irsGroupLimits), (v) => v);
  // The plan judge: retirement money runs out, or a year falls short.
  const outcome = assessPlan(result);
  // Sustainable withdrawal in today's dollars, indexed by age from today's.
  const yearsToRet = Math.max(0, retAge - currentAge);
  const inflRate = Math.max(0, Number(settings.annualInflation) || 0);
  const sustainableWd = toTodaysDollars(
    result.sustainableWithdrawal,
    retAge,
    flatDeflator(currentAge, inflRate),
  );
  // Already retired: the figure is today's, so the label says today's age.
  const nestEggAge = Math.max(retAge, currentAge);
  // Simulated when the Retirement page has run one for these inputs, else
  // the baseline — the same rule and figure the page's hero uses.
  const byYear = flatDeflator(result.projectionByYear[0]?.year ?? 0, inflRate);
  const baseline = baselineNestEgg(result.projectionByYear, nestEggAge);
  const nestEgg = baseline
    ? toTodaysDollars(baseline.nominal, baseline.year, byYear)
    : portfolioTotal;
  const nestEggDisplay = simulatedOrBaseline({
    // Today's dollars, from the Simulation's own per-trial deflation.
    bands: mcPeek?.result?.todayBands,
    baseline: nestEgg,
    targetAge: nestEggAge,
    personFiltered: false,
  });
  const totalWithMatch = annualContributions + employerContributions;
  const retirementBudget = data.decumulationExpenses;
  const taxAdvSpace =
    retLimits > 0 && limitedContributions < retLimits
      ? retLimits - limitedContributions
      : 0;

  return (
    <Card title="Retirement" href="/retirement">
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <NestEggFigure
            nestEggDisplay={nestEggDisplay}
            yearOf={yearOf}
            nestEggAge={nestEggAge}
          />
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Years to retirement</span>
              <span className="text-primary">
                {yearsToRet} yrs{" "}
                <span className="text-caption text-faint">
                  ({result.projectionByYear[0]?.year} → {yearOf(retAge)})
                </span>
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Retirement accounts</span>
              <span className="text-primary">
                {formatCurrency(portfolioTotal)}
              </span>
            </div>
            <RetirementAccountsBreakdown
              retPortfolio={retPortfolio}
              portfolioTotal={portfolioTotal}
            />
            <ContributionsRow
              excludeMatch={excludeMatch}
              annualContributions={annualContributions}
              totalWithMatch={totalWithMatch}
              employerContributions={employerContributions}
            />
            <TaxRoomRow taxAdvSpace={taxAdvSpace} />
            <div className="border-subtle my-1 border-t" />
            {retirementBudget > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Retirement budget</span>
                <span className="text-primary">
                  {formatCurrency(retirementBudget)}/yr
                </span>
              </div>
            )}
            {sustainableWd > 0 && renderWithdrawalRow(settings, sustainableWd)}
            {coastFireData?.result &&
              renderCoastFireRow(coastFireMcPeek, ageLabel, coastFireData)}
            <SimulatedSuccessRow mcPeek={mcPeek} />
            {renderLastRunRow(mcPeek, coastFireMcPeek)}
            <DurationRow endAge={endAge} outcome={outcome} />
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
