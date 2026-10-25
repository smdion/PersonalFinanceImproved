/** Performance reconciliation checks — what fails to fit, per account (part). */
import { describe, it, expect } from "vitest";
import {
  ownerKey,
  performanceChecks,
  type CheckRow,
  type YearEndSnapshot,
} from "@/lib/pure/performance-checks";

let nextId = 1;
const row = (o: Partial<CheckRow>): CheckRow => ({
  id: nextId++,
  year: 2030,
  performanceAccountId: 1,
  ownerPersonId: null,
  beginningBalance: 0,
  totalContributions: 0,
  yearlyGainLoss: 0,
  endingBalance: 0,
  distributions: 0,
  fees: 0,
  rollovers: 0,
  ...o,
});
const kinds = (m: Map<number, { kind: string }[]>, r: CheckRow) =>
  (m.get(r.id) ?? []).map((c) => c.kind);

describe("unbalanced", () => {
  it("flags what the row's figures leave unexplained; cents rounding is not a gap", () => {
    const off = row({
      beginningBalance: 100,
      totalContributions: 50,
      endingBalance: 200,
      yearlyGainLoss: 40,
    });
    const fine = row({
      beginningBalance: 100,
      endingBalance: 110.004,
      yearlyGainLoss: 10,
    });
    const m = performanceChecks([off, fine], []);
    expect(m.get(off.id)).toEqual([
      { kind: "unbalanced", amount: 10, accepted: false },
    ]);
    expect(m.get(fine.id)).toBeUndefined();
  });

  it("an accepted gap stays quiet only while it's the gap accepted", () => {
    const base = {
      beginningBalance: 100,
      endingBalance: 200,
      yearlyGainLoss: 90,
    };
    const same = row({ ...base, accepted: { unbalanced: 10 } });
    const moved = row({
      ...base,
      yearlyGainLoss: 80,
      accepted: { unbalanced: 10 },
    });
    const m = performanceChecks([same, moved], []);
    expect(m.get(same.id)![0]!.accepted).toBe(true);
    expect(m.get(moved.id)![0]).toMatchObject({ amount: 20, accepted: false });
  });
});

describe("chain", () => {
  it("a year that doesn't start where the last ended", () => {
    const y1 = row({ year: 2029, endingBalance: 500, beginningBalance: 500 });
    const y2 = row({ year: 2030, beginningBalance: 575, endingBalance: 575 });
    expect(performanceChecks([y1, y2], []).get(y2.id)).toEqual([
      {
        kind: "chain",
        amount: 75,
        previousYear: 2029,
        previousEnding: 500,
        accepted: false,
      },
    ]);
  });

  it("held in parts: each person against their own part; a change of shape isn't compared", () => {
    const a1 = row({
      year: 2029,
      ownerPersonId: 1,
      endingBalance: 100,
      beginningBalance: 100,
    });
    const b1 = row({
      year: 2029,
      ownerPersonId: 2,
      endingBalance: 300,
      beginningBalance: 300,
    });
    const a2 = row({
      year: 2030,
      ownerPersonId: 1,
      beginningBalance: 100,
      endingBalance: 100,
    });
    const b2 = row({
      year: 2030,
      ownerPersonId: 2,
      beginningBalance: 250,
      endingBalance: 250,
    });
    const m = performanceChecks([a1, b1, a2, b2], []);
    expect(m.get(a2.id)).toBeUndefined();
    expect(kinds(m, b2)).toEqual(["chain"]);

    const pooled = row({
      year: 2031,
      beginningBalance: 999,
      endingBalance: 999,
    });
    expect(
      performanceChecks([a2, b2, pooled], []).get(pooled.id),
    ).toBeUndefined();
  });
});

describe("transfers", () => {
  it("both sides entered → nothing; one side missing → every open row flags the net", () => {
    const out = row({
      performanceAccountId: 1,
      rollovers: -400,
      endingBalance: 0,
      beginningBalance: 400,
    });
    const into = row({
      performanceAccountId: 2,
      rollovers: 400,
      endingBalance: 400,
    });
    expect(performanceChecks([out, into], []).size).toBe(0);

    const lone = row({
      performanceAccountId: 3,
      rollovers: 250,
      endingBalance: 250,
    });
    const m = performanceChecks([out, into, lone], []);
    for (const r of [out, into, lone])
      expect(m.get(r.id)).toEqual([
        { kind: "transfers", amount: 250, accepted: false },
      ]);
  });

  it("a rollover accepted as one-sided (its own amount) drops out of the net", () => {
    const lone = row({
      performanceAccountId: 3,
      rollovers: 250,
      endingBalance: 250,
      accepted: { transfers: 250 },
    });
    const other = row({
      performanceAccountId: 4,
      rollovers: -100,
      beginningBalance: 100,
    });
    const m = performanceChecks([lone, other], []);
    expect(m.get(lone.id)).toEqual([
      { kind: "transfers", amount: 250, accepted: true },
    ]);
    expect(m.get(other.id)).toEqual([
      { kind: "transfers", amount: -100, accepted: false },
    ]);
  });
});

describe("snapshot", () => {
  const snap = (
    byAccount: [number, number][],
    byOwner: [string, number][] = [],
  ): YearEndSnapshot => ({
    year: 2030,
    date: "2030-12-31",
    byAccount: new Map(byAccount),
    byAccountOwner: new Map(byOwner),
  });

  it("ending vs the year's last snapshot; an account missing from it isn't compared", () => {
    const r = row({
      performanceAccountId: 1,
      beginningBalance: 4400,
      endingBalance: 4400,
    });
    const absent = row({
      performanceAccountId: 9,
      beginningBalance: 10,
      endingBalance: 10,
    });
    const m = performanceChecks([r, absent], [snap([[1, 4325]])]);
    expect(m.get(r.id)).toEqual([
      {
        kind: "snapshot",
        amount: 75,
        snapshotDate: "2030-12-31",
        snapshotBalance: 4325,
        accepted: false,
      },
    ]);
    expect(m.get(absent.id)).toBeUndefined();
  });

  it("held in parts: each part against that person's snapshot balance", () => {
    const a = row({
      ownerPersonId: 1,
      beginningBalance: 100,
      endingBalance: 100,
    });
    const b = row({
      ownerPersonId: 2,
      beginningBalance: 300,
      endingBalance: 300,
    });
    const m = performanceChecks(
      [a, b],
      [
        snap(
          [[1, 400]],
          [
            [ownerKey(1, 1), 100],
            [ownerKey(1, 2), 290],
          ],
        ),
      ],
    );
    expect(m.get(a.id)).toBeUndefined();
    expect(m.get(b.id)![0]).toMatchObject({ kind: "snapshot", amount: 10 });
  });

  it("two rows for the same account and person: nothing to compare", () => {
    const d1 = row({ beginningBalance: 100, endingBalance: 100 });
    const d2 = row({ beginningBalance: 100, endingBalance: 100 });
    expect(performanceChecks([d1, d2], [snap([[1, 999]])]).size).toBe(0);
  });
});

describe("calibration", () => {
  it("a one-cent gap is rounding; two cents is a gap", () => {
    const cent = row({
      beginningBalance: 100,
      endingBalance: 110,
      yearlyGainLoss: 10.01,
    });
    const two = row({
      beginningBalance: 100,
      endingBalance: 110,
      yearlyGainLoss: 10.02,
    });
    const m = performanceChecks([cent, two], []);
    expect(m.get(cent.id)).toBeUndefined();
    expect(m.get(two.id)![0]).toMatchObject({
      kind: "unbalanced",
      amount: -0.02,
    });
  });

  it("a past year's snapshot counts only near Dec 31; the latest year's always does", () => {
    const snap = (
      year: number,
      date: string,
      bal: number,
    ): YearEndSnapshot => ({
      year,
      date,
      byAccount: new Map([[1, bal]]),
      byAccountOwner: new Map(),
    });
    const early = row({
      year: 2028,
      beginningBalance: 500,
      endingBalance: 500,
    });
    const late = row({
      year: 2029,
      performanceAccountId: 2,
      beginningBalance: 500,
      endingBalance: 500,
    });
    const current = row({
      year: 2030,
      performanceAccountId: 3,
      beginningBalance: 500,
      endingBalance: 500,
    });
    const m = performanceChecks(
      [early, late, current],
      [
        snap(2028, "2028-11-18", 400),
        { ...snap(2029, "2029-12-27", 0), byAccount: new Map([[2, 400]]) },
        { ...snap(2030, "2030-06-30", 0), byAccount: new Map([[3, 400]]) },
      ],
    );
    expect(m.get(early.id)).toBeUndefined();
    expect(kinds(m, late)).toEqual(["snapshot"]);
    expect(kinds(m, current)).toEqual(["snapshot"]);
  });
});
