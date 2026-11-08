import type { SalaryEntry } from "@/lib/db/salary-entry-defaults";
import {
  type SalaryActiveMap,
  type SalaryProfileActiveMap,
  applyActiveSalary,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { checksPaidYtd } from "@/lib/pure/paycheck/pay-periods-in-year";
import { computeValue } from "@/lib/pure/contributions/contribution-caps";
import {
  computeAnnualContribution,
  fractionFromPercent,
} from "@/lib/pure/contributions/contribution-amount";
import { DEFAULT_PAY_PERIODS_PER_YEAR } from "@/lib/constants";
import { roundToCents } from "@/lib/utils/math";

/** Split YTD actuals proportionally when multiple contribs share a perf
 *  account, by each one's expected YTD: salary × pct × the job's elapsed
 *  pay-period fraction (salary is flat under the active Salary Profile). */
export function splitYtdActuals(
  effectiveContribs: readonly {
    id: number;
    isActive: boolean;
    jobId: number | null;
    performanceAccountId: number | null;
    contributionMethod: string;
    contributionValue: string | number;
    cappedValue?: number;
  }[],
  effectiveJobs: readonly {
    id: number;
    personId: number;
    payPeriod: SalaryEntry["payPeriod"] | undefined;
    anchorPayDate: SalaryEntry["anchorPayDate"] | undefined;
    startDate: string;
  }[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  effectiveSalaryMap: SalaryActiveMap,
  asOfDate: Date,
  perfActualMap: ReadonlyMap<
    number,
    { contributions: number; employerMatch: number }
  >,
) {
  const activeContribs = effectiveContribs.filter((c) => c.isActive);

  // Cache resolved salary and period data per job — used for
  // proportional YTD split.
  const jobCache = new Map<
    number,
    {
      salary: number;
      periodsPerYear: number;
      periodsElapsed: number;
    }
  >();
  for (const c of activeContribs) {
    if (c.performanceAccountId == null || !c.jobId) continue;
    if (jobCache.has(c.jobId)) continue;
    const job = effectiveJobs.find((j) => j.id === c.jobId);
    // No entry for this job in the active Salary Profile — same
    // "nothing to resolve" state as no job at all (the fallback below).
    if (!job || job.payPeriod == null) continue;
    // The same What-If sandbox tier as computeContributionSummary's
    // per-person salary, or expected YTD would keep the Salary Profile's
    // value whenever a What-If salary is set.
    const rawSalary = resolveCompensation(
      salaryProfileActiveMap,
      job.id,
    ).salary;
    const salary = applyActiveSalary(
      job.personId,
      rawSalary,
      effectiveSalaryMap,
    );
    const periodsPerYear = getPeriodsPerYear(job.payPeriod);
    // Expected YTD counts the checks this job has paid — none before
    // a start this year.
    const periodsElapsed = checksPaidYtd(
      asOfDate,
      job.payPeriod,
      job.anchorPayDate,
      periodsPerYear,
      job.startDate,
    );
    jobCache.set(c.jobId, { salary, periodsPerYear, periodsElapsed });
  }

  // Compute expected YTD for each contrib and group by perf account.
  const byPerfId = new Map<
    number,
    { contribId: number; expectedYtd: number }[]
  >();
  for (const c of activeContribs) {
    const value = computeValue(c);
    let expectedYtd = 0;
    const jd = c.jobId ? jobCache.get(c.jobId) : null;
    if (c.contributionMethod === "percent_of_salary" && jd) {
      expectedYtd =
        jd.salary *
        fractionFromPercent(value) *
        (jd.periodsElapsed / jd.periodsPerYear);
    } else {
      const periodsPerYear = jd?.periodsPerYear ?? DEFAULT_PAY_PERIODS_PER_YEAR;
      const periodsElapsed = jd?.periodsElapsed ?? 0;
      const annual = computeAnnualContribution(
        c.contributionMethod,
        value,
        0,
        periodsPerYear,
      );
      expectedYtd = annual * (periodsElapsed / periodsPerYear);
    }

    if (c.performanceAccountId != null) {
      const arr = byPerfId.get(c.performanceAccountId) ?? [];
      arr.push({ contribId: c.id, expectedYtd });
      byPerfId.set(c.performanceAccountId, arr);
    }
  }

  const contribActualMap = new Map<
    number,
    { contributions: number; employerMatch: number }
  >();

  // Split perf account actuals proportionally by expected YTD
  for (const [perfId, entries] of byPerfId) {
    const actual = perfActualMap.get(perfId);
    if (!actual) continue;
    const totalExpected = entries.reduce((s, e) => s + e.expectedYtd, 0);
    for (const entry of entries) {
      const share =
        totalExpected > 0
          ? entry.expectedYtd / totalExpected
          : 1 / entries.length;
      contribActualMap.set(entry.contribId, {
        contributions: roundToCents(actual.contributions * share),
        employerMatch: roundToCents(actual.employerMatch * share),
      });
    }
  }

  return { contribActualMap };
}
