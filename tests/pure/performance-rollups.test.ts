/** Rollup deltas and a finalized year's return after an edit. */
import { describe, it, expect } from "vitest";
import {
  computeReturn,
  rebaseLockedReturn,
  rollupByCategory,
  rollupDeltas,
  sumAccounts,
  type AccountLike,
} from "@/lib/pure/performance";

const acct = (cat: string, o: Partial<AccountLike> = {}) => ({
  cat,
  beginningBalance: "0",
  totalContributions: "0",
  yearlyGainLoss: "0",
  endingBalance: "0",
  employerContributions: "0",
  distributions: "0",
  fees: "0",
  rollovers: "0",
  ...o,
});

describe("rollupByCategory / rollupDeltas", () => {
  it("sums per category, rollovers included", () => {
    const m = rollupByCategory(
      [
        acct("Brokerage", { endingBalance: "100", rollovers: "50" }),
        acct("Brokerage", { endingBalance: "20", rollovers: "-50" }),
        acct("HSA", { endingBalance: "7" }),
      ],
      (r) => r.cat,
    );
    expect(m.get("Brokerage")).toMatchObject({ endBal: 120, rollovers: 0 });
    expect(m.get("HSA")!.endBal).toBe(7);
  });

  it("only categories that moved, by what they moved", () => {
    const before = rollupByCategory(
      [
        acct("Brokerage", {
          endingBalance: "2000.00",
          yearlyGainLoss: "150.00",
        }),
        acct("HSA", { endingBalance: "10" }),
      ],
      (r) => r.cat,
    );
    const after = rollupByCategory(
      [
        acct("Brokerage", {
          endingBalance: "1925.05",
          yearlyGainLoss: "75.05",
        }),
        acct("HSA", { endingBalance: "10" }),
      ],
      (r) => r.cat,
    );
    const d = rollupDeltas(before, after);
    expect([...d.keys()]).toEqual(["Brokerage"]);
    expect(d.get("Brokerage")!.endBal).toBeCloseTo(-74.95, 2);
    expect(d.get("Brokerage")!.gainLoss).toBeCloseTo(-74.95, 2);
  });

  it("an account moving category: out of one, into the other", () => {
    const row = { endingBalance: "500", yearlyGainLoss: "40" };
    const d = rollupDeltas(
      rollupByCategory([acct("401k/IRA", row)], (r) => r.cat),
      rollupByCategory([acct("Brokerage", row)], (r) => r.cat),
    );
    expect(d.get("401k/IRA")!.endBal).toBe(-500);
    expect(d.get("Brokerage")!.endBal).toBe(500);
  });

  it("no change → no deltas", () => {
    const m = rollupByCategory(
      [acct("HSA", { endingBalance: "1" })],
      (r) => r.cat,
    );
    expect(rollupDeltas(m, m).size).toBe(0);
  });
});

describe("rebaseLockedReturn", () => {
  const delta = (o: Partial<ReturnType<typeof sumAccounts>>) => ({
    ...sumAccounts([]),
    ...o,
  });
  const row = {
    beginningBalance: 1000,
    totalContributions: 400,
    yearlyGainLoss: 120,
    distributions: 0,
    fees: 0,
    rollovers: 0,
  };

  it("keeps a stored return's basis when the row can't reproduce it", () => {
    // Stored 10% on a 120 gain → measured against 1,200 of capital.
    // A gain-only edit keeps that capital: 90 / 1,200.
    expect(
      rebaseLockedReturn(
        { ...row, annualReturnPct: 0.1 },
        delta({ gainLoss: -30, endBal: -30 }),
      ),
    ).toBeCloseTo(0.075, 10);
  });

  it("moves the basis by capital the edit moved, weighted like computeReturn", () => {
    // +200 contributions → +100 of capital: 120 / 1,300.
    expect(
      rebaseLockedReturn(
        { ...row, annualReturnPct: 0.1 },
        delta({ contribs: 200, endBal: 200 }),
      ),
    ).toBeCloseTo(120 / 1300, 10);
  });

  it("when the stored return matched the row, the result matches computeReturn", () => {
    const stored = computeReturn(1000, 400, 120, 0, 0, 0)!;
    const d = delta({ gainLoss: -30, contribs: 50, fees: 4 });
    expect(
      rebaseLockedReturn({ ...row, annualReturnPct: stored }, d),
    ).toBeCloseTo(computeReturn(1000, 450, 90, 0, 4, 0)!, 10);
  });

  it("no stored return, or one that says nothing of its basis → computeReturn", () => {
    const d = delta({ gainLoss: 10 });
    const fresh = computeReturn(1000, 400, 130, 0, 0, 0);
    expect(rebaseLockedReturn({ ...row, annualReturnPct: null }, d)).toBe(
      fresh,
    );
    expect(rebaseLockedReturn({ ...row, annualReturnPct: 0 }, d)).toBe(fresh);
    expect(
      rebaseLockedReturn(
        { ...row, yearlyGainLoss: 0, annualReturnPct: 0.05 },
        d,
      ),
    ).toBe(computeReturn(1000, 400, 10, 0, 0, 0));
  });
});
