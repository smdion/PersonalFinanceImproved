/** Per-row fill suggestions. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  gapAfter,
  recordedMovesSince,
  rowsPerAccount,
  snapshotNewMoney,
  withoutRecordedMoves,
  type FillRow,
} from "@/lib/pure/fill-suggestions";

const row = (over: Partial<FillRow>): FillRow => ({
  id: 1,
  simplefinAccountId: 10,
  posted: "2026-05-01",
  amount: 100,
  kind: "contribution",
  transfer: null,
  pending: false,
  voided: false,
  uncertain: false,
  recordedMoveFrom: null,
  ...over,
});

const mix = {
  employeePreTax: 6000,
  employeeRoth: 0,
  employeeOther: 0,
  employer: 3000,
  employerRoth: 0,
};

describe("recorded moves", () => {
  it("count for nothing and are reported as left out", () => {
    const rows = [
      row({ recordedMoveFrom: "Alex IRA (Example)", amount: 500 }),
      row({ id: 2 }),
    ];
    expect(withoutRecordedMoves(rows).map((r) => r.kind)).toEqual([
      "other",
      "contribution",
    ]);
    expect(recordedMovesSince(rows, "2026-04-30")).toEqual({
      amount: 500,
      from: "Alex IRA (Example)",
    });
    expect(recordedMovesSince(rows, "2026-05-01")).toBeNull();
  });
});

describe("gapAfter", () => {
  it("names the first day transactions reach when it's after the baseline's next day", () => {
    expect(gapAfter("2026-03-10", "2026-03-01")).toBe("2026-03-10");
    expect(gapAfter("2026-03-02", "2026-03-01")).toBeNull();
    expect(gapAfter(null, "2026-03-01")).toBeNull();
  });
});

describe("rowsPerAccount", () => {
  it("counts rows per tracked account", () => {
    expect(
      rowsPerAccount([
        { performanceAccountId: 1 },
        { performanceAccountId: 1 },
        { performanceAccountId: 2 },
      ]),
    ).toEqual(
      new Map([
        [1, 2],
        [2, 1],
      ]),
    );
  });
});

describe("snapshotNewMoney", () => {
  const input = {
    mix,
    snapshotDate: "2026-05-01",
    snapshotTooOld: false,
    feeds: [{ id: 10, balanceDay: "2026-05-20" }],
    sendsTransactions: true,
    contributions: [
      row({ posted: "2026-05-10", amount: 300 }),
      row({ posted: "2026-05-25", amount: 999 }), // after the balance date
    ],
    today: "2026-05-28",
  };

  it("splits the deposits the balance includes by the paycheck setup", () => {
    expect(snapshotNewMoney(input)).toMatchObject({
      employeePreTax: 200,
      employer: 100,
      estimated: false,
    });
  });

  it("estimates from the paycheck setup for a balance-only feed", () => {
    expect(
      snapshotNewMoney({ ...input, sendsTransactions: false })?.estimated,
    ).toBe(true);
  });

  it("places nothing without a setup or for a stale snapshot", () => {
    expect(snapshotNewMoney({ ...input, mix: undefined })).toBeNull();
    expect(snapshotNewMoney({ ...input, snapshotTooOld: true })).toBeNull();
  });
});
