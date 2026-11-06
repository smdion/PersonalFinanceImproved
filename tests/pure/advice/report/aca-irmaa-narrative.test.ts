/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal EngineDecumulationYear fixtures without satisfying every unrelated field of the full engine type */
import { describe, it, expect } from "vitest";
import { buildWatchlist } from "@/lib/pure/advice/report/aca-irmaa-narrative";
import type { EngineDecumulationYear } from "@/lib/pure/engine/types/index";
import { calculateProjection } from "@/lib/pure/engine";
import { xfail } from "../../../fixtures/answer-key";
import { engineHousehold } from "../../../fixtures/answer-key-household";

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
  // Bug pin (the all-clear, verdicts N8 and E1): a row with `irmaaCost: 0`
  // reads "No Medicare IRMAA surcharges ... were found", but today 0 also
  // means IRMAA was never computed (awareness off), so the sentence can't
  // tell "none found" from "not checked"; only N8's false "ACA lost" flag
  // hides it. Changes on purpose with the v0.11 Retirement rules items: ACA
  // reported "lost" when never checked, and "IRMAA: always compute it"
  // (decision E1). Answer-key ret/A31, below, holds the decided report.
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

  // Regression guard: acaMagiHeadroom
  // is a NOMINAL dollar figure (grows with the household's income, like
  // every other engine value in nominal-dollar space), so the "close to cliff"
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

// ---------------------------------------------------------------------------
// Answer key: the report for a Medicare couple with the defaults
// (`.scratch/docs/drafts/answer-key.md` § Retirement rules, A31; verdicts
// N8 and § 3; spec § 14.9 A31, adjusted for decision E1)
// ---------------------------------------------------------------------------

describe("answer key: a Medicare couple's report, awareness off", () => {
  // Invented: Ann born 1948 (78 in 2026) and Bo born 1951 (75), MFJ,
  // retired, spending 200,000 a year from Ann's 3,000,000 Traditional IRA,
  // no Social Security, 2026-2028, ACA and IRMAA awareness off (the
  // defaults). Both are on Medicare, so neither can have a premium tax
  // credit (IRC 36B(c)(2)(B); Reg. 1.36B-2(c)(2)): the report has nothing
  // to say about the ACA. Each year's MAGI is the IRA draw, about 231,000
  // (the spending plus about 31,000 of federal tax at 22% on the margin,
  // after 32,200 + 2 × 1,650 of standard deduction and what's left of the
  // senior deduction): anywhere from 218,001 to 274,000 is the first joint
  // IRMAA tier (CMS 2026), 1,148.40 each, 2,296.80 for the two.
  const report = () => {
    const years = calculateProjection(
      engineHousehold({
        status: "MFJ",
        people: [{ birthYear: 1948 }, { birthYear: 1951 }],
        traditionalIra: 3_000_000,
        spending: 200_000,
        endYear: 2029,
      }),
    ).projectionByYear.filter(
      (y): y is EngineDecumulationYear => y.phase === "decumulation",
    );
    return buildWatchlist(years, noopDeflate);
  };
  const count = (pattern: RegExp) =>
    report().items.filter((i) => pattern.test(i.detail)).length;

  describe("ret/A31 [RET-17]", () => {
    // Decided (verdict N8): no ACA item. Today `checkAca` answers "not
    // preserved" when it didn't check, and the report says the subsidy
    // was lost in each of the 3 years (one ranged item).
    xfail({
      id: "ret/A31 [RET-17]",
      todo: 'v0.11 Retirement rules: ACA reported "lost" when never checked (verdict N8)',
      run: () => ({ acaItems: count(/ACA/) }),
      expected: { acaItems: 0 },
      today: { acaItems: 1 },
    });
  });

  describe("ret/A31:irmaa [RET-14]", () => {
    // Decision E1 (IRMAA always computed): the report states the computed
    // surcharge, 2,296.80 a year for the two, so it has an IRMAA item and
    // no all-clear ("No Medicare IRMAA surcharges ... were found"). The
    // source's "doesn't say no IRMAA was found" becomes this (key, sources
    // that disagreed #11). Today awareness off computes nothing: no IRMAA
    // item, and the all-clear is hidden only by the false ACA item above.
    xfail({
      id: "ret/A31:irmaa [RET-14]",
      todo: 'v0.11 Retirement rules "IRMAA: always compute it" (decision E1)',
      run: () => ({
        irmaaItems: count(/IRMAA/),
        allClear: /no medicare irmaa/i.test(report().narrative) ? 1 : 0,
      }),
      expected: { irmaaItems: 1, allClear: 0 },
      today: { irmaaItems: 0, allClear: 0 },
    });
  });
});
