/** A slot's money no contribution spec claims, credited to the slot's own
 *  part (EN14 rule 5) on a run that holds no account. */
import {
  getAccountTypeConfig,
  getAllCategories,
  isOverflowTarget,
} from "../../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import { roundToCents } from "../../../utils/math";
import { isHeldPart } from "../../accounts/account-part";
import type { IndKeyFn } from "../../accounts/account-part";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { ContributionSpec } from "../types/contribution-spec";
import type { AccumulationSlot } from "../types/routing";
import { credit } from "./ledger";

/** The run's parts and what a credit writes to. */
type Ledger = Record<"indAccounts", readonly IndividualAccountInput[]> &
  Record<"indKey", IndKeyFn> &
  Record<"indBalance", Map<string, number>>;

/** A slot's employee money by tax part; the overflow target's net of the
 *  year's IRS overflow, which the overflow step routes. */
function slotTaxParts(
  slot: AccumulationSlot,
  overflow: number,
): [string, number][] {
  const config = getAccountTypeConfig(slot.category);
  if (config.balanceStructure === "roth_traditional")
    return [
      [TAX_TREATMENT_TO_TAX_TYPE.pre_tax, slot.traditionalContrib],
      [TAX_TREATMENT_TO_TAX_TYPE.tax_free, slot.rothContrib],
    ];
  const employee = isOverflowTarget(slot.category)
    ? Math.max(0, roundToCents(slot.employeeContrib - overflow))
    : slot.employeeContrib;
  return [[config.taxBucketKey, employee]];
}

/** The first part of a category and tax type: rule 5's target. */
function firstPart(ledger: Ledger, category: string, taxType: string) {
  return ledger.indAccounts.find(
    (ia) => ia.category === category && ia.taxType === taxType,
  );
}

/**
 * A slot's employee money no spec in its category claims, by tax part, on
 * the first part of each slice (rule 5), only on a run that holds no
 * account: a held run's year-end reconcile places it.
 */
export function unclaimedSlot(
  ledger: Ledger & { overflowToBrokerage: number },
  slot: AccumulationSlot,
  contributions: Map<string, number>,
): void {
  if (ledger.indAccounts.some(isHeldPart)) return;
  for (const [taxType, amount] of slotTaxParts(
    slot,
    ledger.overflowToBrokerage,
  )) {
    const part = firstPart(ledger, slot.category, taxType);
    if (part && amount !== 0)
      credit(ledger.indKey(part), amount, [contributions, ledger.indBalance]);
  }
}

/** Credits each slot and the brokerage ramp to its own part; false when the
 *  run holds an account or has specs (the specs' path applies). */
export function ownPartCredits(
  ledger: Ledger,
  slots: readonly AccumulationSlot[],
  rampAmount: number,
  specs: readonly ContributionSpec[] | undefined,
): boolean {
  const { indAccounts: accounts } = ledger;
  const held = accounts.some(isHeldPart);
  if (held || accounts.length === 0 || (specs && specs.length > 0))
    return false;
  const add = (category: string, taxType: string, amount: number) => {
    const part = firstPart(ledger, category, taxType);
    if (part && amount !== 0)
      credit(ledger.indKey(part), amount, [ledger.indBalance]);
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
  return true;
}
