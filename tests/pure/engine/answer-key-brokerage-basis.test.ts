/**
 * Answer key, brokerage cost basis (ENG-20): basis is what was paid (IRC
 * § 1012), and a sale takes it out at the account's average cost (Treas.
 * Reg. § 1.1012-1(e), average basis; owner design for every brokerage). A
 * loss leaves basis above the balance, so a later sale up to that basis is
 * not a gain; an account sold to $0 has no basis left. Every figure is worked
 * by hand from those rules. Invented accounts only.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  followDraws,
  seedBrokerageBasis,
  sellAtCost,
} from "@/lib/pure/engine/brokerage-basis";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";

const indKey = makeIndKey();

/** One brokerage bought for `basis`, now worth `balance`; it moves to
 *  `recoveredTo`, then `sale` is sold. Returns the sale's gain and the basis
 *  left. */
function sellAfterMove(c: {
  balance: number;
  basis: number;
  recoveredTo: number;
  sale: number;
}) {
  const account = makeIndividualAccount({
    name: "Brokerage",
    category: "brokerage",
    taxType: "afterTax",
    startingBalance: c.balance,
    startingBasis: c.basis,
    parentCategory: "Portfolio",
  });
  const key = indKey(account);
  const basis = seedBrokerageBasis([account], indKey, c.basis);
  const balances = new Map([[key, c.recoveredTo]]);
  const ratio = basis.get(key)! / c.recoveredTo;
  const { gainsPortion } = sellAtCost(c.sale, ratio);
  followDraws([account], indKey, balances, basis, () =>
    balances.set(key, c.recoveredTo - c.sale),
  );
  return { gain: gainsPortion, basisLeft: basis.get(key)! };
}

describe("answer key: brokerage cost basis", () => {
  it("eng/BC-1 [ENG-20] a loss that recovers is sold without a gain", () => {
    // Bought for 15,000, worth 10,000 today, back to 15,000: average cost is
    // 15,000 / 15,000 = 1 a dollar, so a 6,000 sale returns 6,000 of basis,
    // gain 0, and 15,000 − 6,000 = 9,000 of basis stays on 9,000.
    cents(
      sellAfterMove({
        balance: 10_000,
        basis: 15_000,
        recoveredTo: 15_000,
        sale: 6_000,
      }),
      { gain: 0, basisLeft: 9_000 },
    );
  });

  it("eng/BC-2 [ENG-20] an account sold to $0 at a loss keeps no basis", () => {
    // Bought for 12,000, worth 8,000: 1.5 of basis a dollar, so selling all
    // 8,000 returns 8,000 × 1.5 = 12,000 of basis, gain 0, basis left 0.
    cents(
      sellAfterMove({
        balance: 8_000,
        basis: 12_000,
        recoveredTo: 8_000,
        sale: 8_000,
      }),
      { gain: 0, basisLeft: 0 },
    );
  });
});
