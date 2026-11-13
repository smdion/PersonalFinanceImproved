import { safeDivide, roundToCents } from "@/lib/utils/math";
import {
  getDisplayGroup,
  type AccountCategory,
  isPayrollFicaExemptCategory,
} from "@/lib/config/account-types";
import type { ContributionAccountInput } from "@/lib/pure/paycheck/paycheck.types";
import {
  type CapPassed,
  computeValue,
} from "@/lib/pure/contributions/contribution-caps";
import {
  computeAnnualContribution,
  fractionFromPercent,
} from "@/lib/pure/contributions/contribution-amount";
import { toNumber } from "@/lib/utils/numbers";
import { isPaidThroughPayroll } from "@/lib/pure/paycheck/bonus";
import { payrollFicaExemptCap } from "@/lib/pure/contributions/irs-limits";
import type { CheckBasis } from "@/lib/pure/paycheck/year-paydays";
import {
  matchPayGroupsWithBonus,
  matchGroupKey,
  computeGroupedEmployerMatch,
  storedMatchRate,
} from "@/lib/pure/contributions/employer-match";
import { annualContributionWithBonus } from "@/lib/pure/contributions/contribution-rows";
import type { PaycheckContributionRow } from "@/lib/pure/contributions/paycheck-contribution-row";

/** ContributionAccountInput[] from DB rows for a job and person. The match is grouped
 *  (computeGroupedEmployerMatch): a Roth + Traditional split is capped on their combined money. */
export function buildContribAccounts(
  jobContributions: (PaycheckContributionRow & CapPassed)[],
  personalContributions: (PaycheckContributionRow & CapPassed)[],
  salary: number,
  { periodsPerYear, salaryDivisor }: CheckBasis,
  /** The year's limits and the person's age at Dec 31 — sizes each
   *  account's FICA-exempt cap (payrollFicaExemptCap). Required so no
   *  caller can quietly treat exempt payroll money as FICA wages. */
  ficaContext: { limits: Record<string, number>; ageAtYearEnd: number | null },
  /** The job's bonus (contributionPay). Each account takes its share only
   *  when set to (fromBonus); its match counts it the same way
   *  (matchPayGroupsWithBonus). */
  bonusGross = 0,
): ContributionAccountInput[] {
  const allContributions = [...jobContributions, ...personalContributions];
  const bonusGroups = matchPayGroupsWithBonus(allContributions);
  const matchPay = (c: (typeof allContributions)[number]) =>
    salary + (bonusGroups.has(matchGroupKey(c)) ? bonusGross : 0);

  const annualById = new Map<number, number>();
  for (const c of allContributions) {
    const contributionValue = computeValue(c);
    annualById.set(
      c.id,
      computeAnnualContribution(
        c.contributionMethod,
        contributionValue,
        salary,
        periodsPerYear,
      ),
    );
  }

  const matchByRow = computeGroupedEmployerMatch(
    allContributions.map((c) => ({
      id: c.id,
      jobId: c.jobId,
      personId: c.personId,
      accountType: c.accountType,
      parentCategory: c.parentCategory,
      annual: annualContributionWithBonus(
        c,
        { salary, bonusGross },
        periodsPerYear,
      ),
      salary: matchPay(c),
      employerMatchType: c.employerMatchType,
      employerMatchValue: toNumber(c.employerMatchValue),
      employerMatchRate: storedMatchRate(c.employerMatchRate),
      employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
      employerMatchTaxTreatment: c.employerMatchTaxTreatment,
    })),
  );

  // The same match on regular paychecks alone — the difference is what the
  // bonus check's deferral earns (Year-End estimates place it by date).
  const baseMatchByRow =
    bonusGroups.size > 0 && bonusGross > 0
      ? computeGroupedEmployerMatch(
          allContributions.map((c) => ({
            id: c.id,
            jobId: c.jobId,
            personId: c.personId,
            accountType: c.accountType,
            parentCategory: c.parentCategory,
            annual: annualById.get(c.id)!,
            salary,
            employerMatchType: c.employerMatchType,
            employerMatchValue: toNumber(c.employerMatchValue),
            employerMatchRate: storedMatchRate(c.employerMatchRate),
            employerMaxMatchPct: toNumber(c.employerMaxMatchPct),
            employerMatchTaxTreatment: c.employerMatchTaxTreatment,
          })),
        )
      : matchByRow;

  const accounts = allContributions.map((c) => {
    const contributionValue = computeValue(c);
    const annual = annualById.get(c.id)!;
    const perPeriod =
      c.contributionMethod === "fixed_per_period"
        ? contributionValue
        : safeDivide(annual, salaryDivisor, 0);

    const match = matchByRow.get(c.id)!;

    // Group from config displayGroup
    const group = getDisplayGroup(c.accountType as AccountCategory);
    const isPayrollDeducted = isPaidThroughPayroll(c);

    return {
      id: c.id,
      name: c.subType || c.label || c.accountType,
      annualContribution: roundToCents(annual),
      perPeriodContribution: roundToCents(perPeriod),
      rateOfGross:
        c.contributionMethod === "percent_of_salary"
          ? fractionFromPercent(contributionValue)
          : null,
      taxTreatment: c.taxTreatment,
      isPayrollDeducted,
      fromBonus: c.fromBonus === true,
      group,
      employerMatch: roundToCents(match.matchAnnual),
      employerMatchOnBonus: roundToCents(
        match.matchAnnual - baseMatchByRow.get(c.id)!.matchAnnual,
      ),
      employerMatchAvailable: roundToCents(match.matchAvailableAnnual),
      fullMatchShareOfPay: match.fullMatchShareOfPay,
      employerMatchTaxTreatment: match.employerMatchTaxTreatment,
      // A capped row's payroll money is already within the IRS limit less
      // employer money, so all of it is exempt (one split: the cap pass).
      ficaExemptAnnualCap: !isPayrollDeducted
        ? null
        : c.cap && isPayrollFicaExemptCategory(c.accountType)
          ? Infinity
          : payrollFicaExemptCap(
              c.accountType,
              ficaContext.ageAtYearEnd,
              c.hsaCoverageType ?? null,
              ficaContext.limits,
              match.matchAnnual,
            ),
    };
  });
  return accounts;
}
