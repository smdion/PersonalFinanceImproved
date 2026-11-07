import type * as schema from "@/lib/db/schema";
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
import {
  type SalarySegment,
  calculateBlendedAnnual,
  calculatePaycheck,
  checksPaidYtd,
  countPeriodsElapsed,
} from "@/lib/pure/paycheck/paycheck";
import type { buildPaycheckInputForJob } from "@/lib/pure/paycheck/paycheck-input";
import type {
  BlendedAnnualTotals,
  ContributionAccountInput,
  DeductionLine,
  TaxBracketInput,
} from "@/lib/pure/paycheck/paycheck.types";
import { buildContribAccounts } from "@/server/services/contributions/paycheck-accounts";
import type {
  ContribRowWithActiveFields,
  loadAndApplyContribProfile,
} from "@/server/services/contributions/profile";

export function checkPaychecks(
  paycheckInput: ReturnType<typeof buildPaycheckInputForJob>,
  jobContribs: (ContribRowWithActiveFields & CapPassed)[],
  personalContribs: (ContribRowWithActiveFields & CapPassed)[],
  salary: number,
  periodsPerYear: number,
  limitsRecord: Record<string, number>,
  person: typeof schema.people.$inferSelect,
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
  const paystubPaycheck = [...jobContribs, ...personalContribs].some(
    (c) => (c.cap?.overBy ?? 0) > 0,
  )
    ? calculatePaycheck({
        ...paycheckInput,
        contributionAccounts: buildContribAccounts(
          configured(jobContribs),
          configured(personalContribs),
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

export function yearEarnings(
  activeJob: Awaited<
    ReturnType<typeof loadAndApplyContribProfile>
  >["jobs"][number],
  taxYear: number,
  paycheck: ReturnType<typeof calculatePaycheck>,
  periodsPerYear: number,
  salary: number,
  taxBracketInput: TaxBracketInput,
  contribAccounts: ContributionAccountInput[],
  deductions: DeductionLine[],
  endedJobYears: (
    person: typeof schema.people.$inferSelect,
    currentJobId?: number,
  ) => {
    endedJobs: unknown[];
    endedYears: ReturnType<typeof computeAnnualEarnings>[];
    undatedBonusEmployers: string[];
    endedWithheld: { federal: number; fica: number };
  },
  person: typeof schema.people.$inferSelect,
) {
  // Blended annual computation. Salary is a flat number under the
  // active Salary Profile — no mid-year timeline to blend across
  // any more (see resolveCompensation's docblock), so this is
  // always a single segment: the job's checks this year, from its
  // start to its last day.
  // A last day later this year (the job is still current): its
  // checks inside the year stop there.
  const lastDay =
    activeJob.endDate != null &&
    Number(String(activeJob.endDate).slice(0, 4)) === taxYear
      ? new Date(`${String(activeJob.endDate).slice(0, 10)}T12:00:00Z`)
      : null;
  const anchor = activeJob.anchorPayDate ?? activeJob.startDate;
  let blendedAnnual: BlendedAnnualTotals | null = null;
  {
    // The checks it pays this year: from its start, to its last day.
    const salarySegments: SalarySegment[] = [
      {
        salary,
        effectiveDate: null,
        startPeriod: 1 + paycheck.periodsBeforeStart,
        endPeriod: lastDay
          ? Math.min(
              periodsPerYear,
              countPeriodsElapsed(
                lastDay,
                activeJob.payPeriod!,
                new Date(anchor),
              ),
            )
          : periodsPerYear,
        paycheck,
      },
    ];

    blendedAnnual = calculateBlendedAnnual(salarySegments, taxBracketInput);
  }

  // This person's year: salary + the resolved bonus, pre-tax money
  // and FICA wages — what the household tax and every income
  // figure read (household annual income, DESIGN.md).
  // This person's year: every job they had in it, each for the
  // checks it pays inside the year — the current job from its
  // start (to its last day when that's later this year), plus any
  // job that ended this year (household-income.ts).
  const currentJobYear = computeAnnualEarnings({
    salary,
    periodsPerYear,
    paycheck,
    contributionAccounts: contribAccounts,
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
