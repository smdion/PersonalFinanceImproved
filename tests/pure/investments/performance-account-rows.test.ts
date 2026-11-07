/**
 * The Performance summary's account rows (lib/pure/investments/performance-
 * account-rows.ts), on the invented household in
 * tests/helpers/performance-household.ts.
 */
import { describe, expect, it } from "vitest";
import {
  performanceAccountRows,
  performanceBalanceMismatch,
  resolveOwnerName,
} from "@/lib/pure/investments/performance-account-rows";
import { household, perfLookups } from "../../helpers/performance-household";

describe("performance summary account rows", () => {
  const basis = (ownerPersonId: number, contributionBasis: string) => ({
    performanceAccountId: 1,
    ownerPersonId,
    year: 2025,
    contributionBasis,
    conversionBasis: "0",
    latestConversionYear: null,
  });

  it("carries every owner's Roth basis on a row two people hold, and totals it", () => {
    const { accounts } = household();
    const basisRows = [basis(2, "300"), basis(1, "200")];
    const basisByKey = new Map(
      basisRows.map((b) => [
        `${b.performanceAccountId}|${b.ownerPersonId}|${b.year}`,
        b,
      ]),
    );
    const { accountRows } = performanceAccountRows(
      accounts,
      perfLookups,
      basisRows,
      basisByKey,
      new Map([
        [1, "Alex"],
        [2, "Sam"],
      ]),
      new Map(),
      new Map([["1|2025", 1]]),
    );
    const first = accountRows[0]!;
    expect(first.ownerName).toBe("Alex");
    expect(first.contributionBasis).toBe(500);
    expect(first.basisByOwner.map((b) => [b.ownerName, b.recorded])).toEqual([
      ["Alex", true],
      ["Sam", true],
    ]);
    // No basis row for the other accounts' owner: an unrecorded zero entry.
    expect(accountRows[1]!.contributionBasis).toBeNull();
    expect(accountRows[1]!.basisByOwner).toEqual([
      expect.objectContaining({ ownerPersonId: 1, recorded: false }),
    ]);
  });

  it("refuses an owner who isn't a person", () => {
    expect(() => resolveOwnerName(7, new Map())).toThrow(/orphan FK/);
    expect(resolveOwnerName(null, new Map())).toBeNull();
  });
});

describe("performance summary balance mismatch", () => {
  const snapshot = { snapshot: { snapshotDate: "2025-06-01" }, total: 1100 };
  const rows = [{ year: 2025, isActive: true, endingBalance: 1000 }];

  it("reports the gap when the snapshot and the edit share a day", () => {
    expect(
      performanceBalanceMismatch(snapshot, "2025-06-01", rows, 2025),
    ).toEqual({
      balanceMismatch: { perfTotal: 1000, snapTotal: 1100, delta: -100 },
    });
  });

  it("stays quiet on a different day, inside the threshold, or with no snapshot", () => {
    expect(
      performanceBalanceMismatch(snapshot, "2025-06-02", rows, 2025)
        .balanceMismatch,
    ).toBeNull();
    expect(
      performanceBalanceMismatch(
        { ...snapshot, total: 1003 },
        "2025-06-01",
        rows,
        2025,
      ).balanceMismatch,
    ).toBeNull();
    expect(
      performanceBalanceMismatch(null, "2025-06-01", rows, 2025)
        .balanceMismatch,
    ).toBeNull();
  });
});
