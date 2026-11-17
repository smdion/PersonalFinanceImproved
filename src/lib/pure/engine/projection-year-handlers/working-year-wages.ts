/** The payroll money W-2 wages leave out. */
import { roundToCents, sumBy } from "../../../utils/math";
import {
  getAccountTypeConfig,
  isHsaTaxType,
  isPreTaxType,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/tax-treatment-buckets";
import type { AccumulationSlot } from "../types/routing";

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
