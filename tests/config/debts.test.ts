/** A stored debt kind as Ledgr reads it: a kind this version doesn't know
 *  (from a downgrade, a hand edit or SQLite, which has no CHECK) is judged
 *  as Other and named as stored. */
import { describe, it, expect } from "vitest";
import { isHighInterestDebt } from "@/lib/config/debts";
import { readDebtKind } from "@/lib/config/stored-debt-kind";

describe("readDebtKind", () => {
  it("reads a known kind as itself, with its label", () => {
    expect(readDebtKind("credit_card")).toEqual({
      value: "credit_card",
      label: "Credit card",
    });
  });

  it("reads an unknown kind as Other, with a label naming it", () => {
    const read = readDebtKind("heloc");
    expect(read).toEqual({
      value: "other",
      label: 'Unknown kind "heloc" (judged as Other)',
    });
    expect(isHighInterestDebt(read.value, 0.09, 45)).toBe(true);
  });
});
