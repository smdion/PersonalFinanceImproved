/** Matching money moved between the household's own accounts. Invented rows. */
import { describe, it, expect } from "vitest";
import {
  recordedMoveDeposits,
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

describe("recordedMoveDeposits", () => {
  const recorded = (id: number, year: number) =>
    id === 7 && year === 2026 ? "Example ESPP" : null;
  const base = {
    posted: "2026-09-14",
    amount: 500,
    kind: "contribution",
    settled: false,
    performanceAccountId: 7,
  };

  it("flags deposits into an account Performance records money moving into", () => {
    const s = recordedMoveDeposits(
      [
        { ...base, id: 1 },
        { ...base, id: 2, performanceAccountId: 8 }, // nothing recorded there
        { ...base, id: 3, posted: "2025-12-30" }, // other year
        { ...base, id: 4, amount: -500, kind: "withdrawal" },
        { ...base, id: 5, settled: true }, // decided by hand
        { ...base, id: 6, performanceAccountId: null }, // not counted
      ],
      recorded,
    );
    expect([...s]).toEqual([[1, "Example ESPP"]]);
  });
});
