/** A spec's account's other tax part: where a slot's money of a tax type
 *  no spec in its category carries lands. */
import type { ContributionSpec } from "../types/contribution-spec";
import type { IndividualAccountInput } from "../../accounts/account-balances.types";
import { safeDivide, sumBy } from "../../../utils/math";
import { TAX_TREATMENT_TO_TAX_TYPE } from "../../../config/tax-treatment-buckets";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import { specKeyOf } from "./ledger";
import { creditWhole, partShares } from "./part-weights";
import type { SpecParts } from "./spec-accounts";

/**
 * A slot's money of a tax type no spec in its category carries: on each spec
 * account's part of that tax type (the opening state declares it), weighted by
 * the specs' own amounts.
 */
export function otherParts(
  ledger: Record<"indAccounts", IndividualAccountInput[]> &
    Record<"indKey", IndKeyFn> &
    Record<"indBalance", Map<string, number>>,
  specAccount: Map<string, SpecParts>,
  specRaw: Map<string, number>,
  contributions: Map<string, number>,
) {
  const { indAccounts: accounts, indKey: keyOf, indBalance: balances } = ledger;
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
      // Each of the spec's parts, by its share of the spec's money.
      const held = (specAccount.get(sk) ?? []).flatMap((key) =>
        accounts.filter((ia) => keyOf(ia) === key),
      );
      const shares = partShares(ledger, held);
      held.forEach((ia, i) => {
        const part = keyOf({ ...ia, taxType });
        const raw = (specRaw.get(sk) ?? 0) * shares[i]!;
        weights.set(part, (weights.get(part) ?? 0) + raw);
      });
    }
    const total = sumBy([...weights.values()], (w) => w);
    const raw = [...weights.values()].map(
      (w) => slotAmount * safeDivide(w, total, 1 / weights.size),
    );
    creditWhole([...weights.keys()], slotAmount, raw, [
      contributions,
      balances,
    ]);
  };
}
