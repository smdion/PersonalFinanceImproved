/**
 * Answer key, a lump sum's account part (ENG-13): the part a one-time lump
 * sum lands on, by its category and tax type. Owner decisions: a lump sum
 * names its account's side ("traditional"/"roth") and lands on that side's
 * part; a name no such part carries is shared by balance over that
 * category's parts of that tax type, Retirement first. Invented households
 * only.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { applyLumpSums } from "@/lib/pure/engine/projection-year-handlers/lump-sum";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";
import type { LumpSum } from "@/lib/pure/engine/types";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";

const indKey = makeIndKey();
const part = (
  name: string,
  taxType: string,
  startingBalance: number,
  parentCategory = "Retirement",
) =>
  makeIndividualAccount({
    name,
    category: "ira",
    taxType,
    startingBalance,
    parentCategory,
  });

/** Applies `ls` to the parts; returns each part's balance after, by name
 *  and tax type. */
function land(
  ls: LumpSum,
  parts: ReturnType<typeof part>[],
): Record<string, number> {
  const indBalance = new Map(parts.map((p) => [indKey(p), p.startingBalance]));
  const ctx = {
    holdsAccounts: true,
    indAccounts: parts,
    indKey,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionContext;
  const state = {
    balances: { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0, afterTaxBasis: 0 },
    accountBalance: {
      "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    },
    indBalance,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionLoopState;
  applyLumpSums([ls], ctx, state);
  return Object.fromEntries(
    parts.map((p) => [`${p.name} ${p.taxType}`, indBalance.get(indKey(p))!]),
  );
}

describe("answer key: the part a lump sum lands on", () => {
  it("eng/LS-1 [ENG-13] a Roth lump sum with no account named lands on a Roth part", () => {
    // An IRA held as a Traditional part (100,000) and its Roth part (0); a
    // 7,000 Roth lump sum lands on the Roth part: Roth 7,000, Traditional
    // unchanged.
    cents(
      land({ amount: 7_000, targetAccount: "ira", taxType: "roth" }, [
        part("IRA", "preTax", 100_000),
        part("IRA", "taxFree", 0),
      ]),
      { "IRA preTax": 100_000, "IRA taxFree": 7_000 },
    );
  });

  it("eng/LS-2 [ENG-13] a named Roth lump sum lands on that account's Roth part", () => {
    // Two IRAs, each in two parts; 5,000 named "IRA B", Roth side: only
    // IRA B's Roth part takes it (20,000 → 25,000).
    cents(
      land(
        {
          amount: 5_000,
          targetAccount: "ira",
          taxType: "roth",
          targetAccountName: "IRA B",
        },
        [
          part("IRA A", "preTax", 50_000),
          part("IRA A", "taxFree", 10_000),
          part("IRA B", "preTax", 80_000),
          part("IRA B", "taxFree", 20_000),
        ],
      ),
      {
        "IRA A preTax": 50_000,
        "IRA A taxFree": 10_000,
        "IRA B preTax": 80_000,
        "IRA B taxFree": 25_000,
      },
    );
  });

  it("eng/LS-3 [ENG-13] a name no part carries is shared by balance over the Retirement parts of its tax type", () => {
    // 40,000 Traditional named "Old IRA", which no part carries: the
    // Retirement IRAs' Traditional parts share it by balance, 300,000 :
    // 100,000 → 30,000 and 10,000; the Portfolio one and the Roth part
    // take nothing.
    cents(
      land(
        {
          amount: 40_000,
          targetAccount: "ira",
          taxType: "traditional",
          targetAccountName: "Old IRA",
        },
        [
          part("IRA A", "preTax", 300_000),
          part("IRA B", "preTax", 100_000),
          part("IRA B", "taxFree", 50_000),
          part("IRA P", "preTax", 200_000, "Portfolio"),
        ],
      ),
      {
        "IRA A preTax": 330_000,
        "IRA B preTax": 110_000,
        "IRA B taxFree": 50_000,
        "IRA P preTax": 200_000,
      },
    );
  });
});
