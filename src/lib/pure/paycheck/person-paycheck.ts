import type { CapPassed } from "@/lib/pure/contributions/contribution-caps";
import { ficaCapContext } from "@/lib/pure/contributions/irs-limits";
import {
  contributionPay,
  type resolveCompensation,
} from "@/lib/pure/household/compensation";
import {
  computeAnnualEarnings,
  sumHouseholdIncome,
} from "@/lib/pure/household/household-income";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import { yearTotals } from "@/lib/pure/paycheck/year-totals";
import {
  checksPaidYtd,
  countPeriodsElapsed,
} from "@/lib/pure/paycheck/pay-periods-in-year";
import type { buildPaycheckInputForJob } from "@/lib/pure/paycheck/paycheck-input";
import type {
  BlendedAnnualTotals,
  ContributionAccountInput,
  DeductionLine,
} from "@/lib/pure/paycheck/paycheck.types";
import { buildContribAccounts } from "@/lib/pure/contributions/paycheck-accounts";
import type { PaycheckContributionRow } from "@/lib/pure/contributions/paycheck-contribution-row";
import type { PaycheckYearJob } from "@/lib/pure/paycheck/person-paycheck.types";

export function checkPaychecks(
  paycheckInput: ReturnType<typeof buildPaycheckInputForJob>,
  jobContributions: (PaycheckContributionRow & CapPassed)[],
  personalContributions: (PaycheckContributionRow & CapPassed)[],
  salary: number,
  periodsPerYear: number,
  limitsRecord: Record<string, number>,
  person: { dateOfBirth: string },
  taxYear: number,
  bonusTerms: Parameters<typeof contributionPay>[1],
  comp: ReturnType<typeof resolveCompensation>,
) {
  const paycheck = calculatePaycheck(paycheckInput);
  // The pay-stub check compares one real check — what payroll
  // actually deducts, the configured amounts — so a person over an
  // IRS limit gets that check figured on the configured rows.
  const configured = <T extends { cappedValue?: number }>(rows: T[]) =>
    rows.map(({ cappedValue: _capped, ...r }) => r);
  const paystubPaycheck = [...jobContributions, ...personalContributions].some(
    (c) => (c.cap?.overBy ?? 0) > 0,
  )
    ? calculatePaycheck({
        ...paycheckInput,
        contributionAccounts: buildContribAccounts(
          configured(jobContributions),
          configured(personalContributions),
          salary,
          periodsPerYear,
          ficaCapContext(limitsRecord, person.dateOfBirth, taxYear),
          contributionPay(salary, bonusTerms, comp.bonusOverride).bonusGross,
        ),
      })
    : null;
  // The nominal formula figure, ignoring any current-year pin — lets
  // the UI show "target" (formula) alongside "actual" (resolved)
  // instead of only ever showing the resolved value.
  const fullFormulaBonusEstimate =
    paycheckInput.bonusOverride !== null
      ? calculatePaycheck({ ...paycheckInput, bonusOverride: null })
          .bonusEstimate
      : paycheck.bonusEstimate;

  return { paycheck, paystubPaycheck, fullFormulaBonusEstimate };
}

export function yearEarnings<P>(
  activeJob: PaycheckYearJob,
  taxYear: number,
  paycheck: ReturnType<typeof calculatePaycheck>,
  periodsPerYear: number,
  salary: number,
  contributionAccounts: ContributionAccountInput[],
  deductions: DeductionLine[],
  endedJobYears: (
    person: P,
    currentJobId?: number,
  ) => {
    endedJobs: unknown[];
    endedYears: ReturnType<typeof computeAnnualEarnings>[];
    undatedBonusEmployers: string[];
    endedWithheld: { federal: number; fica: number };
  },
  person: P,
) {
  // The job's checks this year: from its start to its last day (when that's later this year,
  // the job's checks stop there), summed from the year schedule.
  const lastDay =
    activeJob.endDate != null &&
    Number(String(activeJob.endDate).slice(0, 4)) === taxYear
      ? new Date(`${String(activeJob.endDate).slice(0, 10)}T12:00:00Z`)
      : null;
  const anchor = activeJob.anchorPayDate ?? activeJob.startDate;
  const firstCheck = 1 + paycheck.periodsBeforeStart;
  const lastCheck = lastDay
    ? Math.min(
        periodsPerYear,
        countPeriodsElapsed(lastDay, activeJob.payPeriod!, new Date(anchor)),
      )
    : periodsPerYear;
  const year = yearTotals(paycheck.yearSchedule, firstCheck, lastCheck);
  const blendedAnnual: BlendedAnnualTotals = {
    gross: year.gross,
    federalWithholding: year.federal,
    ficaSS: year.ficaSS,
    ficaMedicare: year.ficaMedicare,
    preTaxDeductions: year.preTax,
    postTaxDeductions: year.postTax,
    netPay: year.net,
    blendedSalary: salary,
    segments: [
      {
        salary,
        periods: Math.max(0, lastCheck - firstCheck + 1),
        effectiveDate: null,
      },
    ],
  };

  // This person's year: every job they had in it, each for its checks inside the year (salary,
  // resolved bonus, pre-tax money, FICA wages) — what household tax and income figures read.
  const currentJobYear = computeAnnualEarnings({
    salary,
    periodsPerYear,
    paycheck,
    contributionAccounts: contributionAccounts,
    deductions,
    checks: lastDay
      ? checksPaidYtd(
          lastDay,
          activeJob.payPeriod!,
          anchor,
          periodsPerYear,
          activeJob.startDate,
        )
      : periodsPerYear - paycheck.periodsBeforeStart,
    bonusPaid:
      !paycheck.bonusBeforeStart &&
      (lastDay === null ||
        (paycheck.bonusPeriod !== null &&
          paycheck.bonusPeriod <=
            countPeriodsElapsed(
              lastDay,
              activeJob.payPeriod!,
              new Date(anchor),
            ))),
  });
  const { endedJobs, endedYears, endedWithheld, undatedBonusEmployers } =
    endedJobYears(person, activeJob.id);
  // A job leaving this year whose bonus has no date: whether it's
  // paid before the last day isn't known, so it isn't counted.
  const bonusNotCounted = [
    ...(lastDay && paycheck.bonusUndated ? [activeJob.employerName] : []),
    ...undatedBonusEmployers,
  ];
  const earnings =
    endedYears.length > 0
      ? sumHouseholdIncome([currentJobYear, ...endedYears])
      : currentJobYear;
  // A job started this year with no earlier job counted: its pay
  // before the start isn't in Ledgr.
  const start = String(activeJob.startDate).slice(0, 10);
  const yearPayNote =
    paycheck.periodsBeforeStart > 0 && endedYears.length === 0
      ? {
          startDate: start,
          missingEndedJob: endedJobs.length > 0,
        }
      : null;

  return {
    blendedAnnual,
    earnings,
    endedWithheld,
    bonusNotCounted,
    yearPayNote,
  };
}
