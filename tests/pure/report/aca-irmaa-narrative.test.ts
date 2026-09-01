/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal EngineDecumulationYear fixtures without satisfying every unrelated field of the full engine type */
import { describe, it, expect } from "vitest";
import { buildWatchlist } from "@/lib/pure/report/aca-irmaa-narrative";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";

const noopDeflate = (v: number) => v;

function decumYear(
  overrides: Partial<EngineDecumulationYear> = {},
): EngineDecumulationYear {
  return {
    year: 2040,
    age: 65,
    phase: "decumulation",
    rmdShortfallAmount: 0,
    irmaaCost: 0,
    acaSubsidyPreserved: true,
    acaMagiHeadroom: 0,
    ...overrides,
  } as unknown as EngineDecumulationYear;
}

describe("buildWatchlist", () => {
  it("reports a clean plan with no items when nothing is flagged", () => {
    const w = buildWatchlist([decumYear()], noopDeflate);
    expect(w.items).toHaveLength(0);
    expect(w.narrative).toMatch(/no medicare irmaa/i);
  });

  it("flags an RMD shortfall as a warning (real 25% excise tax exposure)", () => {
    const w = buildWatchlist(
      [decumYear({ rmdShortfallAmount: 5000 })],
      noopDeflate,
    );
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.startYear).toBe(2040);
    expect(w.items[0]!.endYear).toBe(2040);
    expect(w.items[0]!.severity).toBe("warning");
    expect(w.items[0]!.detail).toMatch(/excise tax/i);
    expect(w.items[0]!.detail).toMatch(/\$5,000/);
  });

  it("flags a nonzero IRMAA surcharge as informational", () => {
    const w = buildWatchlist([decumYear({ irmaaCost: 1200 })], noopDeflate);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.severity).toBe("info");
    expect(w.items[0]!.detail).toMatch(/IRMAA/);
  });

  it("flags a lost ACA subsidy as a warning, regardless of headroom", () => {
    const w = buildWatchlist(
      [decumYear({ acaSubsidyPreserved: false, acaMagiHeadroom: 0 })],
      noopDeflate,
    );
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.severity).toBe("warning");
    expect(w.items[0]!.detail).toMatch(/lost/i);
  });

  it("flags being close to the ACA cliff (small positive headroom) as informational, not a loss", () => {
    const w = buildWatchlist(
      [decumYear({ acaSubsidyPreserved: true, acaMagiHeadroom: 1500 })],
      noopDeflate,
    );
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.severity).toBe("info");
    expect(w.items[0]!.detail).toMatch(/within/i);
  });

  // Phase 4 regression guard (2026-08-31, advisor-caught): acaMagiHeadroom
  // is a NOMINAL dollar figure (grows with the household's income, like
  // every other engine value post-Phase-4), so the "close to cliff"
  // comparison against a flat REAL-dollar threshold must deflate FIRST.
  // Uses a real (non-identity) deflator, unlike every other test in this
  // file -- this is the only case where nominal-vs-real actually matters:
  // nominal headroom ($5,400) sits comfortably above
  // ACA_CLOSE_TO_CLIFF_THRESHOLD ($3,000), but the same dollars deflated
  // 20 years back to today's terms ($5,400 / 1.03^20 ≈ $2,990) fall just
  // under it. Comparing nominal (the bug this test catches if
  // reintroduced) would silently miss this household's real proximity to
  // the cliff.
  it("flags ACA proximity using REAL (deflated) headroom, not nominal -- nominal-looks-safe but real-is-close", () => {
    const realDeflate = (v: number, year: number) =>
      v / Math.pow(1.03, year - 2026);
    const w = buildWatchlist(
      [
        decumYear({
          year: 2046,
          acaSubsidyPreserved: true,
          acaMagiHeadroom: 5400,
        }),
      ],
      realDeflate,
    );
    expect(w.items).toHaveLength(1);
    expect(w.items[0]!.severity).toBe("info");
    expect(w.items[0]!.detail).toMatch(/within/i);
    // The rendered sentence shows the DEFLATED figure (~$2,990), not the
    // raw nominal $5,400 -- the specific thing the nominal-comparison bug
    // this test guards against would have gotten wrong.
    expect(w.items[0]!.detail).toMatch(/\$2,9\d\d/);
    expect(w.items[0]!.detail).not.toMatch(/\$5,400/);
  });

  it("does not flag ACA proximity when headroom is comfortably large", () => {
    const w = buildWatchlist(
      [decumYear({ acaSubsidyPreserved: true, acaMagiHeadroom: 50000 })],
      noopDeflate,
    );
    expect(w.items).toHaveLength(0);
  });

  it("aggregates multiple distinct concerns across years into one summary narrative", () => {
    const w = buildWatchlist(
      [
        decumYear({ year: 2040, rmdShortfallAmount: 1000 }),
        decumYear({ year: 2041, irmaaCost: 500 }),
        decumYear({ year: 2042, acaSubsidyPreserved: false }),
      ],
      noopDeflate,
    );
    expect(w.items).toHaveLength(3);
    expect(w.narrative).toMatch(/Required Minimum Distribution shortfall/i);
    expect(w.narrative).toMatch(/IRMAA surcharge/i);
    expect(w.narrative).toMatch(/ACA subsidy loss/i);
  });

  it("collapses a long run of consecutive same-condition years into one ranged entry, not one line per year", () => {
    const years = Array.from({ length: 40 }, (_, i) =>
      decumYear({ year: 2044 + i, acaSubsidyPreserved: false }),
    );
    const w = buildWatchlist(years, noopDeflate);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]).toMatchObject({ startYear: 2044, endYear: 2083 });
    expect(w.items[0]!.detail).toMatch(/40 years/);
    // A ranged entry can't show one exact dollar figure (amounts vary
    // within the range) — must not claim a single-year detail.
    expect(w.items[0]!.detail).not.toMatch(/this year\b/);
  });

  it("does not merge a broken run — a gap year restarts the range", () => {
    const years = [
      decumYear({ year: 2044, acaSubsidyPreserved: false }),
      decumYear({ year: 2045, acaSubsidyPreserved: false }),
      decumYear({
        year: 2046,
        acaSubsidyPreserved: true,
        acaMagiHeadroom: 50000,
      }), // gap
      decumYear({ year: 2047, acaSubsidyPreserved: false }),
    ];
    const w = buildWatchlist(years, noopDeflate);
    expect(w.items).toHaveLength(2);
    expect(w.items[0]).toMatchObject({ startYear: 2044, endYear: 2045 });
    expect(w.items[1]).toMatchObject({ startYear: 2047, endYear: 2047 });
  });

  it("groups two different concurrent kinds independently, each into its own range", () => {
    const years = [
      decumYear({
        year: 2044,
        rmdShortfallAmount: 1000,
        acaSubsidyPreserved: false,
      }),
      decumYear({
        year: 2045,
        rmdShortfallAmount: 1200,
        acaSubsidyPreserved: false,
      }),
    ];
    const w = buildWatchlist(years, noopDeflate);
    expect(w.items).toHaveLength(2);
    const kinds = w.items.map((i) => i.detail.slice(0, 20));
    expect(kinds.some((d) => /Required Minimum/.test(d))).toBe(true);
    expect(kinds.some((d) => /ACA premium/.test(d))).toBe(true);
  });
});
