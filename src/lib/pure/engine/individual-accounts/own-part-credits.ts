/** EN14 rule 5: a run that holds no account and has no specs credits each
 *  slot to its own part, by the split the category totals take, rather than
 *  leaving those parts to the year-end reconcile. */
import {
  getAccountTypeConfig,
  getAllCategories,
  isOverflowTarget,
} from "../../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import { isHeldPart } from "../../accounts/account-part";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { ContributionSpec } from "../types/contribution-spec";
import type { AccumulationSlot } from "../types/routing";

/** Each part's credit from the slots and the brokerage ramp, or undefined
 *  when the run holds an account or has specs (the specs' path applies). */
export function ownPartCredits(
  slots: readonly AccumulationSlot[],
  rampAmount: number,
  specs: readonly ContributionSpec[] | undefined,
  accounts: readonly IndividualAccountInput[],
): [IndividualAccountInput, number][] | undefined {
  const held = accounts.some(isHeldPart);
  if (held || accounts.length === 0 || (specs && specs.length > 0)) return;
  const credits: [IndividualAccountInput, number][] = [];
  const add = (category: string, taxType: string, amount: number) => {
    const part = accounts.find(
      (ia) => ia.category === category && ia.taxType === taxType,
    );
    if (part && amount !== 0) credits.push([part, amount]);
  };
  for (const slot of slots) {
    const config = getAccountTypeConfig(slot.category);
    if (config.balanceStructure === "roth_traditional") {
      const traditional = slot.traditionalContrib + slot.employerMatch;
      add(slot.category, TAX_TREATMENT_TO_TAX_TYPE.pre_tax, traditional);
      add(slot.category, TAX_TREATMENT_TO_TAX_TYPE.tax_free, slot.rothContrib);
    } else {
      const total = slot.employeeContrib + slot.employerMatch;
      add(slot.category, config.taxBucketKey, total);
    }
  }
  const overflow = getAllCategories().find(isOverflowTarget)!;
  add(overflow, getAccountTypeConfig(overflow).taxBucketKey, rampAmount);
  return credits;
}
