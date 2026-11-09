import {
  planAgeLabel,
  yearOfPlanAge,
} from "@/lib/pure/household/household-timeline";
import { flatDeflator, toTodaysDollars } from "@/lib/pure/simulation/dollars";
import {
  baselineNestEgg,
  simulatedOrBaseline,
} from "@/lib/pure/retirement/nest-egg-display";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";
import type { RouterOutputs } from "@/lib/trpc";
import type { useDashboardProjection } from "@/lib/hooks/use-dashboard-projection";
import { sumBy } from "@/lib/utils/math";
import { categoriesWithIrsLimit } from "@/lib/config/account-types";
import { PERF_CATEGORY_RETIREMENT } from "@/lib/config/display-labels";
import type { AccountCategory } from "@/lib/config/account-types";
import { filterYearByParentCategory } from "@/components/retirement-projection/utils";

export function retirementCardFigures(
  projected: Extract<
    NonNullable<ReturnType<typeof useDashboardProjection>["data"]>,
    { settings: unknown }
  > & {
    result: NonNullable<
      Extract<
        NonNullable<ReturnType<typeof useDashboardProjection>["data"]>,
        { settings: unknown }
      >["result"]
    >;
  },
  simulationSummary:
    RouterOutputs["projection"]["peekMonteCarloSummary"] | undefined,
) {
  const { settings, irsGroupLimits, portfolioByTaxTypeByParentCat } = projected;
  const retirementResult = {
    ...projected.result,
    projectionByYear: projected.result.projectionByYear.map((yearRow) =>
      filterYearByParentCategory(yearRow, PERF_CATEGORY_RETIREMENT),
    ),
  };
  const years = retirementResult.projectionByYear;
  const retirementSpecs = projected.contributionSpecs.filter(
    (s) => s.parentCategory === PERF_CATEGORY_RETIREMENT,
  );
  const retPortfolio = portfolioByTaxTypeByParentCat[PERF_CATEGORY_RETIREMENT];
  const retirementAge = settings.retirementAge;
  const endAge = settings.endAge;
  const currentAge = years[0]?.age ?? 0;
  const firstRow = years[0] ?? {
    year: new Date().getFullYear(),
    age: currentAge,
  };
  const yearOf = (age: number) => yearOfPlanAge(firstRow, age);
  const ageLabel = (age: number) =>
    planAgeLabel(
      firstRow,
      projected.people.find((p) => p.id === projected.primaryPersonId)?.name,
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
  const outcome = assessPlan(retirementResult);
  // Sustainable withdrawal in today's dollars, indexed by age from today's.
  const yearsToRet = Math.max(0, retirementAge - currentAge);
  const inflationRate = Math.max(0, Number(settings.annualInflation) || 0);
  const sustainableWithdrawal = toTodaysDollars(
    retirementResult.sustainableWithdrawal,
    retirementAge,
    flatDeflator(currentAge, inflationRate),
  );
  // Already retired: the figure is today's, so the label says today's age.
  const nestEggAge = Math.max(retirementAge, currentAge);
  // Simulated when the Retirement page has run one for these inputs, else
  // the baseline — the same rule and figure the page's hero uses.
  const byYear = flatDeflator(years[0]?.year ?? 0, inflationRate);
  const baseline = baselineNestEgg(years, nestEggAge);
  const nestEgg = baseline
    ? toTodaysDollars(baseline.nominal, baseline.year, byYear)
    : portfolioTotal;
  const nestEggDisplay = simulatedOrBaseline({
    // Today's dollars, from the Simulation's own per-trial deflation.
    bands: simulationSummary?.result?.todayBands,
    baseline: nestEgg,
    targetAge: nestEggAge,
    personFiltered: false,
  });
  const totalWithMatch = annualContributions + employerContributions;
  const retirementBudget = projected.decumulationExpenses;
  const taxAdvSpace =
    retLimits > 0 && limitedContributions < retLimits
      ? retLimits - limitedContributions
      : 0;

  return {
    settings,
    retirementResult,
    retPortfolio,
    retirementAge,
    endAge,
    currentAge,
    yearOf,
    ageLabel,
    portfolioTotal,
    annualContributions,
    employerContributions,
    outcome,
    yearsToRet,
    sustainableWithdrawal,
    nestEggAge,
    nestEggDisplay,
    totalWithMatch,
    retirementBudget,
    taxAdvSpace,
  };
}
