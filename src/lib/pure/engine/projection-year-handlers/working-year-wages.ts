/** A working year's income as later years read it: its W-2 wages. */
import { roundToCents, safeDivide, sumBy } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isHsaTaxType,
  isPreTaxType,
  type AccountCategory,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/tax-treatment-buckets";
import type { IncomeBesideWages, YearIncome } from "@/lib/pure/tax/year-income";
import type { AccumulationSlot } from "../types/routing";

const NOTHING_BESIDE_WAGES: IncomeBesideWages = {
  traditionalDraws: 0,
  rothTaxableGrowth: 0,
  realizedGains: 0,
  socialSecurity: { gross: 0, taxable: 0 },
};

/** The employee money a slot holds that income tax skips: its pre-tax and
 *  HSA parts, each part by its tax type. */
function skippedIn(slot: AccumulationSlot): number {
  const type = getAccountTypeConfig(slot.category);
  if (!type.isPayrollDeductible) return 0;
  const parts: [string, number][] =
    type.balanceStructure === "roth_traditional"
      ? [
          [TAX_TREATMENT_TO_TAX_TYPE.pre_tax, slot.traditionalContrib],
          [TAX_TREATMENT_TO_TAX_TYPE.tax_free, slot.rothContrib],
        ]
      : [[type.taxBucketKey, slot.employeeContrib]];
  return sumBy(
    parts.filter(([taxType]) => isPreTaxType(taxType) || isHsaTaxType(taxType)),
    ([, amount]) => amount,
  );
}

/** The payroll money the slots hold that W-2 wages leave out. */
export function payrollTaxSkipped(slots: readonly AccumulationSlot[]): number {
  return roundToCents(sumBy(slots, skippedIn));
}

/** A working year's full-year W-2 wages: its full-year pay less a full
 *  year's skipped payroll money. A year-0 slot holds `proRate` of a year less
 *  its category's `lateYearCut`, so its skipped share of both is grossed up. */
export function fullYearWages(
  pay: number,
  slots: readonly AccumulationSlot[],
  proRate: number,
  lateYearCut: Readonly<Record<AccountCategory, number>>,
): number {
  const skipped = sumBy(slots, (slot) => {
    const share = safeDivide(skippedIn(slot), slot.employeeContrib);
    const cut = lateYearCut[slot.category] * share;
    return safeDivide(skippedIn(slot) + cut, proRate);
  });
  return roundToCents(pay - skipped);
}

/** A working year's income: its wages and, in a gap year, the draw's
 *  streams and the year's Social Security. */
export function workingYearIncome(
  wages: number,
  besideWages: IncomeBesideWages = NOTHING_BESIDE_WAGES,
): YearIncome {
  return { wages, rothConversions: 0, ...besideWages };
}
