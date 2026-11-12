import type { ContributionMethod } from "@/lib/config/enum-values";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";
import {
  type SalaryActiveMap,
  type SalaryProfileActiveMap,
  thisYearJobPay,
} from "@/lib/pure/household/compensation";
import { whatIfForJob } from "@/lib/pure/household/profiles";
import { getPeriodsPerYear } from "@/lib/config/pay-periods";
import { checksPaidYtd } from "@/lib/pure/paycheck/pay-periods-in-year";
import { computeValue } from "@/lib/pure/contributions/contribution-caps";
import {
  computeAnnualContribution,
  fractionFromPercent,
} from "@/lib/pure/contributions/contribution-amount";
import { roundToCents } from "@/lib/utils/math";

/** Split YTD actuals among contributions sharing a performance account by each one's expected
 *  YTD: salary × pct × the job's elapsed pay-period fraction (flat salary per Salary Profile). */
export function splitYtdActuals(
  effectiveContributions: readonly {
    id: number;
    isActive: boolean;
    jobId: number | null;
    performanceAccountId: number | null;
    contributionMethod: ContributionMethod;
    contributionValue: string | number;
    cappedValue?: number;
  }[],
  effectiveJobs: readonly {
    id: number;
    personId: number;
    payPeriod: SalaryEntry["payPeriod"] | undefined;
    anchorPayDate: SalaryEntry["anchorPayDate"] | undefined;
    startDate: string;
    endDate: string | null;
    isSpeculative: boolean;
  }[],
  salaryProfileActiveMap: SalaryProfileActiveMap,
  effectiveSalaryMap: SalaryActiveMap,
  asOfDate: Date,
  perfActualMap: ReadonlyMap<
    number,
    { contributions: number; employerMatch: number }
  >,
) {
  const activeContributions = effectiveContributions.filter((c) => c.isActive);

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
  for (const c of activeContributions) {
    if (c.performanceAccountId == null || !c.jobId) continue;
    if (jobCache.has(c.jobId)) continue;
    const job = effectiveJobs.find((j) => j.id === c.jobId);
    // No entry for this job in the active Salary Profile — same
    // "nothing to resolve" state as no job at all (the fallback below).
    if (!job || job.payPeriod == null) continue;
    // A What-If salary is the person's current job's only (whatIfForJob).
    const { salary } = thisYearJobPay(
      job,
      salaryProfileActiveMap,
      whatIfForJob(job, effectiveJobs, asOfDate, effectiveSalaryMap),
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
  for (const c of activeContributions) {
    const value = computeValue(c);
    // No job it can resolve: no checks paid, nothing expected.
    let expectedYtd = 0;
    const jd = c.jobId ? jobCache.get(c.jobId) : null;
    if (c.contributionMethod === "percent_of_salary" && jd) {
      expectedYtd =
        jd.salary *
        fractionFromPercent(value) *
        (jd.periodsElapsed / jd.periodsPerYear);
    } else if (jd) {
      const annual = computeAnnualContribution(
        c.contributionMethod,
        value,
        0,
        jd.periodsPerYear,
      );
      expectedYtd = annual * (jd.periodsElapsed / jd.periodsPerYear);
    }

    if (c.performanceAccountId != null) {
      const arr = byPerfId.get(c.performanceAccountId) ?? [];
      arr.push({ contribId: c.id, expectedYtd });
      byPerfId.set(c.performanceAccountId, arr);
    }
  }

  const contributionActualMap = new Map<
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
      contributionActualMap.set(entry.contribId, {
        contributions: roundToCents(actual.contributions * share),
        employerMatch: roundToCents(actual.employerMatch * share),
      });
    }
  }

  return { contributionActualMap };
}
