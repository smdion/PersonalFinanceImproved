/** A slot's money no contribution spec claims:
 *  the run's Retirement parts of its slice take it, by balance. */
import {
  getAccountTypeConfig,
  isOverflowTarget,
  isRetirementMoney,
} from "../../../config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import { roundToCents } from "../../../utils/math";
import type { IndKeyFn } from "../../accounts/account-part";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import type { AccumulationSlot } from "../types/routing";
import { creditByWeight } from "./part-weights";

/** The run's parts, their parents, and the balances a credit writes to. */
type Ledger = Record<"indAccounts", readonly IndividualAccountInput[]> &
  Record<"indKey", IndKeyFn> &
  Record<"indBalance", Map<string, number>> &
  Record<"indParentCat", Map<string, string>> &
  Record<"overflowToBrokerage", number>;

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

/**
 * A slot's employee money that no spec in its category claims, by tax part:
 * the run's Retirement-parented parts of each slice take it by weight
 * (`creditByWeight`). Credits contributions too.
 */
export function unclaimedSlot(
  ledger: Ledger,
  slot: AccumulationSlot,
  contributions: Map<string, number>,
): void {
  for (const [taxType, amount] of slotTaxParts(
    slot,
    ledger.overflowToBrokerage,
  )) {
    const parts = ledger.indAccounts.filter(
      (ia) =>
        ia.category === slot.category &&
        ia.taxType === taxType &&
        isRetirementMoney(
          ledger.indParentCat.get(ledger.indKey(ia)) ?? ia.parentCategory,
        ),
    );
    if (amount === 0 || parts.length === 0) continue;
    creditByWeight(ledger, parts, amount, [contributions, ledger.indBalance]);
  }
}
