import {
  type AccountCategory,
  buildCategoryRecord,
  getAllCategories,
  isPortfolioParent,
} from "../../../config/account-types";
import { roundToCents, sumBy, safeDivide } from "../../../utils/math";
import type { resolveAccumulationConfig } from "../override-resolution";
import { contributionStateForYear } from "@/lib/pure/contributions/contribution-state";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** Year 0's basis (UD-01): paycheck amounts or specs, share, late-year cut. */
export function yearZeroBasis(
  yearIndex: number,
  setup: PreYearSetup,
  activeBaseYearContributions: ProjectionLoopState["activeBaseYearContributions"],
  activeBaseYearEmployerMatch: ProjectionLoopState["activeBaseYearEmployerMatch"],
  firstYearFraction: number,
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
) {
  // Year 0 uses the paycheck's per-account amounts (salary × rate can make
  // false overflow), unless a job starts or ends this year or someone isn't
  // at work: the paycheck doesn't know that; the specs do.
  const useRealContributions =
    yearIndex === 0 &&
    !setup.jobEdgeThisYear &&
    !setup.yearSpecs &&
    activeBaseYearContributions &&
    activeBaseYearEmployerMatch;

  // Pro-rate year 0 contributions/match based on months remaining in the year
  const proRate = yearIndex === 0 ? firstYearFraction : 1;

  // Late in year 0, an over-limit contribution was paid at its configured
  // rate so far: what's left is max(0, capped − configured × elapsed), not
  // capped × the rest of the year. The cut per category, off the pro-rated.
  const lateYearCut = buildCategoryRecord(() => 0);
  if (yearIndex === 0)
    for (const s of contributionSpecs ?? []) {
      if (s.configuredAnnual === undefined) continue;
      const left = Math.max(
        0,
        s.baseAnnual - s.configuredAnnual * (1 - proRate),
      );
      lateYearCut[s.category] += Math.max(0, s.baseAnnual * proRate - left);
    }
  const totalLateYearCut = sumBy(Object.values(lateYearCut), (v) => v);

  return { useRealContributions, proRate, lateYearCut, totalLateYearCut };
}

/** The year's contribution target and employer match, before IRS caps. */
export function yearContributionTarget(
  useRealContributions: ReturnType<
    typeof yearZeroBasis
  >["useRealContributions"],
  activeBaseYearContributions: ProjectionLoopState["activeBaseYearContributions"],
  proRate: number,
  totalLateYearCut: number,
  contributionSpecs: ProjectionLoopState["contributionSpecs"],
  projectedSalary: number,
  lgf: number,
  config: ReturnType<typeof resolveAccumulationConfig>,
  activeBaseYearEmployerMatch: ProjectionLoopState["activeBaseYearEmployerMatch"],
  activeEmployerMatchRateByCategory: ProjectionLoopState["activeEmployerMatchRateByCategory"],
  input: ProjectionContext["input"],
  hasPerPersonSalary: boolean,
  projectedSalaryByPerson: PreYearSetup["effectiveSalaryByPerson"],
  currentSalary: number,
  setup: PreYearSetup,
  state: ProjectionLoopState,
) {
  let targetContribution: number;
  if (useRealContributions) {
    targetContribution = roundToCents(
      Object.values(activeBaseYearContributions!).reduce((s, v) => s + v, 0) *
        proRate -
        totalLateYearCut,
    );
  } else if (contributionSpecs && contributionSpecs.length > 0) {
    // Sum projected per-account contributions (before IRS capping)
    targetContribution = roundToCents(
      contributionSpecs.reduce((sum, spec) => {
        if (spec.method === "percent_of_salary") {
          return sum + projectedSalary * spec.salaryFraction * spec.value;
        }
        return sum + spec.baseAnnual * lgf;
      }, 0) * proRate,
    );
  } else {
    targetContribution = roundToCents(
      projectedSalary * Math.max(0, config.contributionRate) * proRate,
    );
  }

  // Employer match (grows with salary in future years; pro-rated for year 0)
  const yearEmployerMatch: Record<AccountCategory, number> = Object.fromEntries(
    getAllCategories().map((cat) => [
      cat,
      useRealContributions
        ? roundToCents((activeBaseYearEmployerMatch![cat] ?? 0) * proRate)
        : roundToCents(
            projectedSalary *
              Math.max(0, activeEmployerMatchRateByCategory[cat] ?? 0) *
              proRate,
          ),
    ]),
  ) as Record<AccountCategory, number>;
  // With pay per person, each spec's match is its share of the category's
  // base-year match grown with its own person's pay, not the household
  // rate: raises differ, and someone may not be at work this year.
  const baseSalaryByPerson = input.salaryByPerson ?? {};
  const personPay = hasPerPersonSalary
    ? { projected: projectedSalaryByPerson, base: baseSalaryByPerson }
    : undefined;
  if (!useRealContributions && hasPerPersonSalary && contributionSpecs) {
    const payRatio = (personId: number | null | undefined) =>
      personId == null
        ? safeDivide(projectedSalary, currentSalary, 0)
        : safeDivide(
            projectedSalaryByPerson.get(personId) ?? 0,
            baseSalaryByPerson[personId] ?? 0,
            0,
          );
    // A category with no spec holding its match keeps the household rate
    // (specs saying nothing about whose it is) — unless someone's away,
    // when the away specs are what's left of it.
    const owned = new Set(
      contributionSpecs
        .filter((s) => (s.employerShare ?? 0) > 0)
        .map((s) => s.category),
    );
    for (const cat of getAllCategories())
      if (owned.has(cat) || setup.yearSpecs) yearEmployerMatch[cat] = 0;
    for (const spec of contributionSpecs)
      yearEmployerMatch[spec.category] +=
        (spec.employerShare ?? 0) *
        (activeBaseYearEmployerMatch?.[spec.category] ??
          Math.max(0, activeEmployerMatchRateByCategory[spec.category] ?? 0) *
            currentSalary) *
        payRatio(spec.personId) *
        proRate;
    for (const cat of getAllCategories())
      yearEmployerMatch[cat] = roundToCents(yearEmployerMatch[cat]);
  }
  const contribution = contributionStateForYear({
    actual: Boolean(useRealContributions),
    savingStopped: setup.savingStopped,
    rate: config.contributionRate,
    defaultRate: state.accumulationDefaults.contributionRate,
    salary: projectedSalary,
  });
  // Stopped: no contributions and no match, whichever path sized them.
  if (contribution.kind === "stopped") {
    targetContribution = 0;
    for (const cat of getAllCategories()) yearEmployerMatch[cat] = 0;
  }

  // Paused: no match that depends on contributing; flat employer money stays.
  if (contribution.kind === "paused") {
    if (!contributionSpecs?.length) {
      for (const cat of getAllCategories()) yearEmployerMatch[cat] = 0;
    } else {
      const kept = buildCategoryRecord(() => 1);
      for (const spec of contributionSpecs)
        if (
          !isPortfolioParent(spec.parentCategory) &&
          spec.matchNeedsContribution !== false
        )
          kept[spec.category] -= spec.employerShare ?? 0;
      for (const cat of getAllCategories())
        yearEmployerMatch[cat] = roundToCents(
          yearEmployerMatch[cat] * Math.max(0, kept[cat]),
        );
    }
  }

  return { targetContribution, yearEmployerMatch, personPay, contribution };
}
