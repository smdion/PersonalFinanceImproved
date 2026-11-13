/** A year's extra payday (a 27th or 53rd check): each account past the checks its yearly money
 *  covers takes only its limit group's room left. Payroll stops at the IRS limit. */
import type {
  ContributionAccountInput,
  ContributionCut,
  PaycheckInput,
} from "./paycheck.types";
import { getPeriodsPerYear } from "../../config/pay-periods";
import { checkWithholding } from "./check-withholding";
import { isPreTax, regularFicaExemptPerPeriod } from "./taxable-wages";

/** What a usual check deducts and withholds. */
export type CheckMoney = {
  preTax: number;
  postTax: number;
  ficaBase: number;
  federalTaxableGross: number;
  federalWithholding: number;
};

/** A check by its payday this year (1 = the year's first): the usual money, or with what it
 *  doesn't take (the cut): its own deductions, FICA base and withholding. */
export function checkMoneyFor(input: PaycheckInput, usual: CheckMoney) {
  const cutFor = extraCheckCuts(input.contributionAccounts);
  return (payday: number): CheckMoney & { cut?: ContributionCut } => {
    const cut = cutFor(payday);
    if (!cut) return usual;
    const federalTaxableGross = usual.federalTaxableGross + cut.preTax;
    return {
      preTax: usual.preTax - cut.preTax,
      postTax: usual.postTax - cut.postTax,
      ficaBase: usual.ficaBase + cut.ficaExempt,
      federalTaxableGross,
      federalWithholding: checkWithholding(
        input,
        federalTaxableGross,
        getPeriodsPerYear(input.payPeriod),
      ).federalWithholding,
      cut,
    };
  };
}

/** A job's checks by payday, in order: what each one doesn't take, or null when it takes every
 *  account's usual amount. Past an account's covered paydays (the periods the cap pass counts) it takes only
 *  its limit group's room, used up check by check, and FICA-exempt money only up to the cap left. */
function extraCheckCuts(accounts: readonly ContributionAccountInput[]) {
  const left = new Map<string, number>();
  const exemptLeft = new Map<ContributionAccountInput, number>();
  return (payday: number): ContributionCut | null => {
    const cut: ContributionCut = { preTax: 0, postTax: 0, ficaExempt: 0 };
    for (const ca of accounts) {
      const limit = ca.extraCheckLimit;
      if (!ca.isPayrollDeducted || !limit) continue;
      if (ca.coveredChecks === undefined || payday <= ca.coveredChecks)
        continue;
      const room = left.has(limit.group) ? left.get(limit.group)! : limit.room;
      const take = Math.min(ca.perPeriodContribution, room);
      left.set(limit.group, room - take);
      const notTaken = ca.perPeriodContribution - take;
      if (isPreTax(ca.taxTreatment)) cut.preTax += notTaken;
      else cut.postTax += notTaken;
      const exempt = regularFicaExemptPerPeriod(ca, ca.coveredChecks);
      if (exempt === 0) continue;
      const capLeft = exemptLeft.has(ca)
        ? exemptLeft.get(ca)!
        : Math.max(0, ca.ficaExemptAnnualCap! - exempt * ca.coveredChecks);
      const exemptTaken = Math.min(take, capLeft);
      exemptLeft.set(ca, capLeft - exemptTaken);
      cut.ficaExempt += exempt - exemptTaken;
    }
    return cut.preTax !== 0 || cut.postTax !== 0 || cut.ficaExempt !== 0
      ? cut
      : null;
  };
}
