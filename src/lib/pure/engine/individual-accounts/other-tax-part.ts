/** A spec's account's other tax part: where a slot's money of a tax type
 *  no spec in its category carries lands. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { roundToCents, safeDivide, sumBy } from "../../../utils/math";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { credit, specKeyOf } from "./ledger";

/**
 * A slot's money of a tax type no spec in its category carries: on each spec
 * account's part of that tax type (the opening state declares it), weighted by
 * the specs' own amounts.
 */
export function otherParts(
  {
    indAccounts: accounts,
    indKey: keyOf,
    indBalance: balances,
  }: Record<"indAccounts", IndividualAccountInput[]> &
    Record<"indKey", IndKeyFn> &
    Record<"indBalance", Map<string, number>>,
  specAccount: Map<string, string>,
  specRaw: Map<string, number>,
  contributions: Map<string, number>,
) {
  return (
    specs: ContributionSpec[],
    taxTreatment: "pre_tax" | "tax_free",
    slotAmount: number,
  ) => {
    if (slotAmount <= 0) return;
    const taxType = TAX_TREATMENT_TO_TAX_TYPE[taxTreatment];
    const weights = new Map<string, number>();
    for (const sp of specs) {
      const sk = specKeyOf(sp);
      const held = accounts.find((ia) => keyOf(ia) === specAccount.get(sk));
      if (!held) continue;
      const part = keyOf({ ...held, taxType });
      weights.set(part, (weights.get(part) ?? 0) + (specRaw.get(sk) ?? 0));
    }
    const total = sumBy([...weights.values()], (w) => w);
    for (const [part, w] of weights) {
      const share = safeDivide(w, total, 1 / weights.size);
      credit(part, roundToCents(slotAmount * share), [contributions, balances]);
    }
  };
}
