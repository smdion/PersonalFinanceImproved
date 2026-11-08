import {
  type AccountCategory,
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getLimitGroup,
} from "@/lib/config/account-types";
import { calculateContributions } from "@/lib/pure/contributions/contribution-totals";
import type { ContributionInput } from "@/lib/pure/contributions/contribution.types";
import {
  computeSiblingTotal,
  ficaCapContext,
  isEligibleForPriorYear,
  resolveIrsLimit,
  resolvePriorYearLimit,
} from "@/lib/pure/contributions/irs-limits";
import {
  type SalaryActiveMap,
  type SalaryProfileActiveMap,
  applyActiveBonusTerms,
  applyActiveSalary,
  contributionPay,
  getTotalCompensation,
  resolveCompensation,
} from "@/lib/pure/household/compensation";
import type { ContributionAccountInput } from "@/lib/pure/paycheck/paycheck.types";
import { roundToCents } from "@/lib/utils/math";
import { toNumber } from "@/lib/utils/numbers";
import { buildContribAccounts } from "@/lib/pure/contributions/paycheck-accounts";
import type { ContribAccountRow } from "@/lib/pure/contributions/contrib-account-row";
import type { ContribAccountsForInput } from "@/lib/pure/contributions/person-snapshot.types";
import type { PerContribData } from "@/lib/pure/contributions/summary.types";

export function personPay(
  salaryProfileActiveMap: SalaryProfileActiveMap,
  activeJob: { id: number },
  effectiveSalaryMap: SalaryActiveMap,
  person: { id: number },
) {
  const comp = resolveCompensation(salaryProfileActiveMap, activeJob.id);
  // The What-If sandbox can override salary and/or bonus terms
  // independently of the Salary Profile's own resolved values.
  const personEntry = effectiveSalaryMap.get(person.id);
  const dbSalary = applyActiveSalary(
    person.id,
    comp.salary,
    effectiveSalaryMap,
  );
  const bonusTerms = applyActiveBonusTerms(personEntry, comp.terms);
  // Base salary + the bonus (each account takes from it only when
  // set to, fromBonus) —
  // the paycheck's way (contributionPay / bonusCheckContribution).
  // This year's figures: the pinned bonus when there is one, like
  // the paycheck (SalaryEntry.bonusOverride).
  const pay = contributionPay(dbSalary, bonusTerms, comp.bonusOverride);
  const salary = pay.salary;
  // Total compensation this year (salary + this year's bonus) — the
  // savings rate denominator.
  const totalCompensation =
    comp.bonusOverride != null
      ? dbSalary + comp.bonusOverride
      : getTotalCompensation(dbSalary, bonusTerms);

  return { dbSalary, pay, salary, totalCompensation };
}

export function contribAccountsFor<R extends ContribAccountRow>({
  effectiveContribs,
  activeJob,
  person,
  pay,
  asOfDate,
  salary,
  periodsPerYear,
  limitsRecord,
  totalCompensation,
  age,
  priorYearLimitsRecord,
}: ContribAccountsForInput<R>) {
  const jobContribs = effectiveContribs.filter((c) => c.jobId === activeJob.id);
  const personalContribs = effectiveContribs.filter(
    (c) =>
      c.jobId === null && c.personId === person.id && c.ownership !== "joint",
  );

  // The day this year's bonus check is paid (null: no bonus date set).
  const bonusDate =
    pay.bonusGross > 0 && activeJob.bonusMonth != null
      ? new Date(
          asOfDate.getFullYear(),
          activeJob.bonusMonth - 1,
          activeJob.bonusDayOfMonth ?? 1,
        )
      : null;
  const accounts = buildContribAccounts(
    jobContribs,
    personalContribs,
    salary,
    periodsPerYear,
    ficaCapContext(limitsRecord, person.dateOfBirth, asOfDate.getFullYear()),
    pay.bonusGross,
  );
  const rawContribs = [...jobContribs, ...personalContribs];

  const input: ContributionInput = {
    annualSalary: salary,
    totalCompensation,
    contributionAccounts: accounts,
    limits: limitsRecord,
    asOfDate,
  };

  const result = calculateContributions(input);

  // Resolve IRS limit for an account type (with coverage variant + catchup)
  const resolveContribLimit = (
    accountType: string,
    hsaCoverageType: string | null,
  ): number => resolveIrsLimit(accountType, age, hsaCoverageType, limitsRecord);

  // Resolve prior-year IRS limit for an account type
  const resolveContribPriorYearLimit = (
    accountType: string,
    hsaCoverageType: string | null,
  ): number =>
    resolvePriorYearLimit(
      accountType,
      age,
      hsaCoverageType,
      priorYearLimitsRecord,
    );

  return {
    bonusDate,
    accounts,
    rawContribs,
    result,
    resolveContribLimit,
    resolveContribPriorYearLimit,
  };
}

export function perContribRows(
  rawContribs: ContribAccountRow[],
  accounts: ContributionAccountInput[],
  resolveContribLimit: (
    accountType: string,
    hsaCoverageType: string | null,
  ) => number,
  inPriorYearWindow: boolean,
  priorYear: number,
  resolveContribPriorYearLimit: (
    accountType: string,
    hsaCoverageType: string | null,
  ) => number,
  contribActualMap: Map<
    number,
    { contributions: number; employerMatch: number }
  >,
) {
  const perContribData: PerContribData[] = rawContribs.map((rc, i) => {
    const annual = accounts[i]!.annualContribution;
    const matchAnnual = accounts[i]!.employerMatch;
    const group = getLimitGroup(rc.accountType as AccountCategory);
    const limit = resolveContribLimit(rc.accountType, rc.hsaCoverageType);
    // Sibling total: other contribs in same limit group for this person
    // When matchCountsTowardLimit, include sibling employer matches too (e.g. HSA)
    const cfg = categoriesWithIrsLimit().includes(
      rc.accountType as AccountCategory,
    )
      ? getAccountTypeConfig(rc.accountType as AccountCategory)
      : null;
    const siblingAnnualTotal = group
      ? computeSiblingTotal(
          rawContribs.map((rc, idx) => ({
            accountType: rc.accountType,
            annualContribution: accounts[idx]!.annualContribution,
            employerMatch: accounts[idx]!.employerMatch,
          })),
          i,
          cfg?.matchCountsTowardLimit ?? false,
        )
      : 0;

    // Prior-year contribution tracking — only use amount if it's tagged for the correct year
    const rawPyAmount = toNumber(rc.priorYearContribAmount);
    const priorYearAmount =
      rc.priorYearContribYear === priorYear ? rawPyAmount : 0;
    let priorYearData: PerContribData["priorYear"];
    if (
      isEligibleForPriorYear(inPriorYearWindow, rc.accountType, priorYearAmount)
    ) {
      const pyLimit = resolveContribPriorYearLimit(
        rc.accountType,
        rc.hsaCoverageType,
      );
      priorYearData = {
        amount: priorYearAmount,
        limit: pyLimit,
        remaining: Math.max(0, pyLimit - priorYearAmount),
      };
    }

    return {
      contribId: rc.id,
      annualAmount: roundToCents(annual),
      employerMatchAnnual: roundToCents(matchAnnual),
      limit,
      siblingAnnualTotal: roundToCents(siblingAnnualTotal),
      limitGroup: group,
      ytdActual: contribActualMap.get(rc.id) ?? null,
      priorYear: priorYearData,
    };
  });

  return { perContribData };
}
