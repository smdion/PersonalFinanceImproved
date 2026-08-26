/**
 * Unit tests for roth-basis-rollover.ts's year-scoped Roth basis lifecycle.
 * Missing test coverage found in code review, 2026-08-27 — this module
 * shipped with no test file at all despite touching finalized financial
 * records, per its own docblock's non-trivial edge-case behavior (never
 * dropping a locked-in basis figure back to "nothing entered").
 */
import { describe, it, expect } from "vitest";
import {
  selectCurrentRothBasisRow,
  buildCurrentRothBasisMap,
  computeRothBasisRollover,
  type RothBasisRollupRow,
} from "@/lib/pure/roth-basis-rollover";

function row(overrides: Partial<RothBasisRollupRow>): RothBasisRollupRow {
  return {
    id: 1,
    performanceAccountId: 100,
    ownerPersonId: 1,
    year: 2025,
    contributionBasis: 10000,
    conversionBasis: 0,
    latestConversionYear: null,
    isFinalized: false,
    ...overrides,
  };
}

describe("selectCurrentRothBasisRow", () => {
  it("returns null for an empty history", () => {
    expect(selectCurrentRothBasisRow([])).toBeNull();
  });

  it("returns the single row when there's only one", () => {
    const r = row({ id: 1, year: 2025 });
    expect(selectCurrentRothBasisRow([r])).toEqual(r);
  });

  it("prefers the latest NON-finalized row when one exists, even if an older finalized row is more recent in the array", () => {
    const finalized2026 = row({ id: 1, year: 2026, isFinalized: true });
    const nonFinalized2025 = row({ id: 2, year: 2025, isFinalized: false });
    // The finalized row is chronologically LATER but must lose to the
    // non-finalized one -- "current" means the live, editable row, not
    // just the newest year.
    expect(
      selectCurrentRothBasisRow([finalized2026, nonFinalized2025]),
    ).toEqual(nonFinalized2025);
  });

  it("falls back to the latest FINALIZED row when every row is finalized (no successor was ever seeded)", () => {
    const older = row({ id: 1, year: 2024, isFinalized: true });
    const newer = row({ id: 2, year: 2025, isFinalized: true });
    // Never returns nothing just because the most recent finalize didn't
    // seed a successor -- that would silently drop a real, locked-in
    // basis figure back to "nothing entered" (the module's own docblock).
    expect(selectCurrentRothBasisRow([older, newer])).toEqual(newer);
  });

  it("ties on year among non-finalized rows resolve to SOME row, not a crash (reduce's first-wins-on-tie behavior)", () => {
    const a = row({ id: 1, year: 2025, isFinalized: false });
    const b = row({ id: 2, year: 2025, isFinalized: false });
    const result = selectCurrentRothBasisRow([a, b]);
    expect([a, b]).toContainEqual(result);
  });

  it("mixed history: multiple finalized years plus one non-finalized picks the non-finalized regardless of year ordering", () => {
    const rows = [
      row({ id: 1, year: 2022, isFinalized: true }),
      row({ id: 2, year: 2023, isFinalized: true }),
      row({ id: 3, year: 2024, isFinalized: false }),
      row({ id: 4, year: 2021, isFinalized: true }),
    ];
    expect(selectCurrentRothBasisRow(rows)?.id).toBe(3);
  });
});

describe("buildCurrentRothBasisMap", () => {
  it("returns an empty map for no rows", () => {
    expect(buildCurrentRothBasisMap([]).size).toBe(0);
  });

  it("selects the current row independently per (account, owner) pair", () => {
    const pairA = [
      row({
        id: 1,
        performanceAccountId: 100,
        ownerPersonId: 1,
        year: 2024,
        isFinalized: true,
      }),
      row({
        id: 2,
        performanceAccountId: 100,
        ownerPersonId: 1,
        year: 2025,
        isFinalized: false,
      }),
    ];
    const pairB = [
      row({
        id: 3,
        performanceAccountId: 200,
        ownerPersonId: 2,
        year: 2023,
        isFinalized: true,
      }),
    ];
    const map = buildCurrentRothBasisMap([...pairA, ...pairB]);
    expect(map.size).toBe(2);
    expect(map.get("100|1")?.id).toBe(2);
    expect(map.get("200|2")?.id).toBe(3);
  });

  it("a pair with no rows at all is simply absent from the map, not present with a null/zero entry", () => {
    const rows = [row({ id: 1, performanceAccountId: 100, ownerPersonId: 1 })];
    const map = buildCurrentRothBasisMap(rows);
    expect(map.has("999|999")).toBe(false);
  });
});

describe("computeRothBasisRollover", () => {
  it("finalizes every row passed in, regardless of seeding outcome", () => {
    const rows = [
      row({ id: 1, performanceAccountId: 100, ownerPersonId: 1, year: 2025 }),
      row({ id: 2, performanceAccountId: 200, ownerPersonId: 2, year: 2025 }),
    ];
    const { idsToFinalize } = computeRothBasisRollover(rows, new Set());
    expect(idsToFinalize.sort()).toEqual([1, 2]);
  });

  it("seeds a next-year row for a pair with no existing successor", () => {
    const r = row({
      id: 1,
      performanceAccountId: 100,
      ownerPersonId: 1,
      year: 2025,
      contributionBasis: 15000,
      conversionBasis: 2500.5,
      latestConversionYear: 2023,
    });
    const { rowsToSeed } = computeRothBasisRollover(r ? [r] : [], new Set());
    expect(rowsToSeed).toHaveLength(1);
    expect(rowsToSeed[0]).toEqual({
      performanceAccountId: 100,
      ownerPersonId: 1,
      year: 2026,
      contributionBasis: "15000.00",
      conversionBasis: "2500.50",
      latestConversionYear: 2023,
    });
  });

  it("skips seeding for a pair that already has a next-year row (entered before finalize ran) — never overwrites it", () => {
    const r = row({
      id: 1,
      performanceAccountId: 100,
      ownerPersonId: 1,
      year: 2025,
    });
    const { rowsToSeed, idsToFinalize } = computeRothBasisRollover(
      [r],
      new Set(["100|1"]),
    );
    expect(rowsToSeed).toHaveLength(0);
    // Still finalizes the row itself even when skipping the seed.
    expect(idsToFinalize).toEqual([1]);
  });

  it("row-driven, not account-driven: a pair absent from rowsAtYear is never force-created at $0", () => {
    const { rowsToSeed } = computeRothBasisRollover([], new Set());
    expect(rowsToSeed).toHaveLength(0);
  });

  it("mixed batch: seeds only the pairs without an existing next-year row, finalizes all", () => {
    const rows = [
      row({ id: 1, performanceAccountId: 100, ownerPersonId: 1, year: 2025 }),
      row({ id: 2, performanceAccountId: 200, ownerPersonId: 2, year: 2025 }),
      row({ id: 3, performanceAccountId: 300, ownerPersonId: 3, year: 2025 }),
    ];
    const { idsToFinalize, rowsToSeed } = computeRothBasisRollover(
      rows,
      new Set(["200|2"]),
    );
    expect(idsToFinalize.sort()).toEqual([1, 2, 3]);
    expect(rowsToSeed.map((r) => r.performanceAccountId).sort()).toEqual([
      100, 300,
    ]);
  });
});
