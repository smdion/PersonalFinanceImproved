/** The opening parts with every part below $0 covered: a part saved below $0
 *  (a margin balance, an overdrawn account) is netted once, at the start,
 *  against the parts of its own category side and parent. */
import { isRetirementMoney } from "../../config/account-types";
import { roundToCents } from "../../utils/math";
import type { IndividualAccountInput } from "../accounts/account-balances.types";
import { accountIdKeyOf } from "../accounts/account-part";
import { categorySide } from "../accounts/category-side";
import { sliceKey } from "./category-slices";
import { debitByBalance } from "./individual-accounts/debit-by-balance";

/** A part's money that its slice and parent couldn't cover, counted as $0. */
export type UncoveredPart = { name: string; amount: number };

/** Each part below $0 set to $0, what it owes taken by balance from its
 *  side's parts of its parent (never the other parent's); what they can't
 *  cover is named in `uncovered`, by part in the parts' order. */
export function coverNegativeParts(parts: readonly IndividualAccountInput[]): {
  parts: IndividualAccountInput[];
  uncovered: UncoveredPart[];
} {
  const balances = new Map(
    parts.map((ia) => [accountIdKeyOf(ia), ia.startingBalance]),
  );
  const groups = new Map<string, IndividualAccountInput[]>();
  for (const ia of parts) {
    const side = categorySide(ia.category, ia.taxType);
    const group = `${sliceKey(ia.category, side)}|${isRetirementMoney(ia.parentCategory)}`;
    groups.set(group, [...(groups.get(group) ?? []), ia]);
  }
  const uncovered: UncoveredPart[] = [];
  for (const group of groups.values()) {
    const owing = group.filter((ia) => ia.startingBalance < 0);
    if (owing.length === 0) continue;
    const held = group.filter((ia) => ia.startingBalance > 0);
    const owed = -owing.reduce((s, ia) => s + ia.startingBalance, 0);
    const heldTotal = held.reduce((s, ia) => s + ia.startingBalance, 0);
    let cover = roundToCents(Math.min(owed, heldTotal));
    const ledger = { balances, keyOf: accountIdKeyOf };
    debitByBalance(ledger, held, cover);
    for (const ia of owing) {
      const covered = Math.min(-ia.startingBalance, cover);
      cover = roundToCents(cover - covered);
      const left = roundToCents(-ia.startingBalance - covered);
      if (left > 0) uncovered.push({ name: ia.name, amount: left });
      balances.set(accountIdKeyOf(ia), 0);
    }
  }
  return {
    parts: parts.map((ia) => {
      const balance = balances.get(accountIdKeyOf(ia))!;
      if (balance === ia.startingBalance) return ia;
      // A taken part's basis leaves with its money; a part raised to $0 from
      // below holds no basis, and no Roth basis to take out tax-free.
      if (ia.startingBalance < 0)
        return {
          ...ia,
          startingBalance: balance,
          ...(ia.startingBasis != null ? { startingBasis: 0 } : {}),
          ...(ia.rothBasisMeta
            ? {
                rothBasisMeta: {
                  ...ia.rothBasisMeta,
                  contributionBasis: 0,
                  conversionBasis: 0,
                },
              }
            : {}),
        };
      const basis =
        ia.startingBasis != null
          ? roundToCents(ia.startingBasis * (balance / ia.startingBalance))
          : undefined;
      return {
        ...ia,
        startingBalance: balance,
        ...(basis != null ? { startingBasis: basis } : {}),
      };
    }),
    uncovered,
  };
}
