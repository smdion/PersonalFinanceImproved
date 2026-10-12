/** Matching money moved between the household's own accounts. Invented rows. */
import { describe, it, expect } from "vitest";
import {
  suggestOneSidedTransfers,
  matchInternalTransfers,
  type TransferCandidate,
} from "@/lib/pure/internal-transfers";

let next = 1;
const row = (over: Partial<TransferCandidate>): TransferCandidate => ({
  id: next++,
  simplefinAccountId: 1,
  performanceAccountId: 10,
  ownerPersonId: null,
  taxType: null,
  posted: "2026-09-04",
  amount: 0,
  kind: "contribution",
  ...over,
});

describe("matchInternalTransfers", () => {
  it("pairs a conversion within one person, even when another person moved the same amount", () => {
    const aliceTradOut = row({
      simplefinAccountId: 1,
      ownerPersonId: 1,
      taxType: "preTax",
      kind: "withdrawal",
      amount: -625,
    });
    const bobTradOut = row({
      simplefinAccountId: 2,
      ownerPersonId: 2,
      taxType: "preTax",
      kind: "withdrawal",
      amount: -625,
    });
    const bobRothIn = row({
      simplefinAccountId: 4,
      ownerPersonId: 2,
      taxType: "taxFree",
      amount: 625,
    });
    const aliceRothIn = row({
      simplefinAccountId: 3,
      ownerPersonId: 1,
      taxType: "taxFree",
      amount: 625,
    });
    const m = matchInternalTransfers([
      aliceTradOut,
      bobTradOut,
      bobRothIn,
      aliceRothIn,
    ]);
    expect(m.get(aliceTradOut.id)).toEqual({
      pairId: aliceRothIn.id,
      conversion: true,
    });
    expect(m.get(bobTradOut.id)).toEqual({
      pairId: bobRothIn.id,
      conversion: true,
    });
  });

  it("leaves a deposit from outside alone", () => {
    const deposit = row({ simplefinAccountId: 1, amount: 625 });
    expect(matchInternalTransfers([deposit]).size).toBe(0);
  });

  it("matches a rollover between two tracked accounts as a transfer, not a conversion", () => {
    const out = row({
      simplefinAccountId: 5,
      performanceAccountId: 20,
      kind: "withdrawal",
      amount: -2160.85,
    });
    const inn = row({
      simplefinAccountId: 6,
      performanceAccountId: 21,
      amount: 2160.85,
      posted: "2026-09-07",
    });
    expect(matchInternalTransfers([out, inn]).get(out.id)).toEqual({
      pairId: inn.id,
      conversion: false,
    });
  });

  it("needs equal cents, a few days at most, and two different linked accounts", () => {
    const out = row({
      simplefinAccountId: 1,
      kind: "withdrawal",
      amount: -625,
    });
    expect(
      matchInternalTransfers([
        out,
        row({ simplefinAccountId: 2, amount: 625.01 }),
      ]).size,
    ).toBe(0);
    expect(
      matchInternalTransfers([
        out,
        row({ simplefinAccountId: 2, amount: 625, posted: "2026-09-20" }),
      ]).size,
    ).toBe(0);
    expect(
      matchInternalTransfers([out, row({ simplefinAccountId: 1, amount: 625 })])
        .size,
    ).toBe(0);
    expect(
      matchInternalTransfers([
        out,
        row({ simplefinAccountId: 2, amount: 625, performanceAccountId: null }),
      ]).size,
    ).toBe(0);
  });
});

describe("suggestOneSidedTransfers", () => {
  const base = {
    simplefinAccountId: 1,
    counted: true,
    posted: "2026-09-14",
    kind: "contribution",
    description: "CASH",
    settled: false,
    performanceAccountId: 7,
  };

  it("pairs with an equal, opposite amount in an account that isn't counted", () => {
    const s = suggestOneSidedTransfers([
      { ...base, id: 1, amount: 2160.85 },
      {
        ...base,
        id: 2,
        simplefinAccountId: 9,
        counted: false,
        performanceAccountId: null,
        kind: "withdrawal",
        amount: -2160.85,
        posted: "2026-09-11",
      },
    ]);
    expect(s.get(1)).toEqual({ reason: "pair", pairId: 2 });
    expect(s.has(2)).toBe(false); // not counted: nothing to suggest on it
  });

  it("uses Performance's recorded move-in, then the description", () => {
    const recorded = (id: number, year: number) =>
      id === 7 && year === 2026 ? "Example ESPP" : null;
    const s = suggestOneSidedTransfers(
      [
        { ...base, id: 1, amount: 500 },
        {
          ...base,
          id: 2,
          amount: 500,
          performanceAccountId: 8,
          description: "ROLLOVER IN",
        },
        { ...base, id: 3, amount: 500, performanceAccountId: 8 },
      ],
      recorded,
    );
    expect(s.get(1)).toEqual({
      reason: "recorded",
      fromAccount: "Example ESPP",
    });
    expect(s.get(2)).toEqual({ reason: "words" });
    expect(s.has(3)).toBe(false);
  });

  it("leaves matched and hand-set rows alone", () => {
    const s = suggestOneSidedTransfers([
      {
        ...base,
        id: 1,
        amount: 500,
        settled: true,
        description: "TRANSFER IN",
      },
    ]);
    expect(s.size).toBe(0);
  });
});
