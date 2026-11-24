/**
 * Answer key, retirement: the Medicare IRMAA surcharge, its tier edges, the
 * next cliff, the MAGI it reads and the two-year lookback
 * (`.scratch/docs/drafts/answer-key.md` § Retirement rules; rulings in
 * `reviews/2026-11-01/rebuild/retirement-verdicts.md`, rules and worked
 * cases in `reviews/2026-11-01/specs/retirement-rules.md` § 4.3, § 10 and
 * § 14.8). Ids are the spec's own, prefixed `ret/` (the same letters repeat
 * in other areas); the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the published amounts, never read
 * from `src/`. A year's surcharge per enrolled person is (Part B IRMAA +
 * Part D IRMAA) × 12, the monthly amounts from the CMS fact sheets:
 *
 * - CMS26: CMS, "2026 Medicare Parts A & B Premiums and Deductibles"
 *   (Nov 14, 2025), Part B and Part D IRMAA tables. Individual MAGI
 *   > 109,000 / > 137,000 / > 171,000 / > 205,000 / ≥ 500,000; joint
 *   > 218,000 / > 274,000 / > 342,000 / > 410,000 / ≥ 750,000. Part B
 *   81.20 / 202.90 / 324.60 / 446.30 / 487.00, Part D 14.50 / 37.50 /
 *   60.40 / 83.30 / 91.00. A year: 95.70 × 12 = 1,148.40; 240.40 × 12 =
 *   2,884.80; 385.00 × 12 = 4,620.00; 529.60 × 12 = 6,355.20; 578.00 × 12
 *   = 6,936.00.
 * - CMS25: the same fact sheet for 2025. Individual > 106,000 first; Part
 *   B 74.00 + Part D 13.70 = 87.70 × 12 = 1,052.40.
 *
 * The rule: 20 CFR 418.1115(b)-(d) (each tier starts "greater than" its
 * threshold, the top one "greater than or equal to"; spec IM-7), 418.1120
 * (status for the lookback year; HOH and QSS use the individual table),
 * 418.1135(a) and 42 USC 1395r(i)(4)(B)(i) (premium year Y reads the tax
 * year beginning in Y−2; IM-2), 1395r(i)(4)(A) and 418.1010(b)(6) (MAGI =
 * AGI + tax-exempt interest; nontaxable Social Security isn't added; IM-3),
 * 418.1101(a) (charged per enrolled person; IM-5), 418.1201-1225 (a
 * life-changing event lowers it only on request; IM-11 to IM-15).
 *
 * Under test: `getIrmaaCost` and `getNextIrmaaCliff`
 * (`src/lib/config/irmaa-tables.ts`) on the shipped yearly brackets (commit
 * 3 checks every shipped cell against CMS; these cases check the function).
 * The lookback and per-person cases (I10, I11, I26-I30) give the function
 * the MAGI and count the rule picks; the engine's own lookback and count
 * are the retirement engine answer key's (v0.9.10 "Through the engine"),
 * except the Medicare count at exactly 65 (RT35), below. Decision E1 (always
 * compute IRMAA, charged on top) changes where the engine charges it, not
 * any figure here.
 *
 * Not written here (one header for the closed cases of the bulk group,
 * v0.11 Retirement rules "Answer key, retirement bulk group"):
 * - I16, I17, I18, I19, I20, I22 (married filing separately, lived with or
 *   apart from the spouse): closed, decision B2 keeps MFS unsupported and
 *   discloses it.
 * - C1, C2, C3, C4 (tax withheld from a conversion, rolling over an RMD):
 *   closed by the verdict's "Ignore" ruling.
 * Blocked with an item that unblocks them: the `it.todo`s at the end.
 */
import { describe, expect, it } from "vitest";
import { cents, runOneYear } from "../fixtures/answer-key";
import { calculateProjection } from "@/lib/pure/engine";
import {
  getIrmaaCost,
  getNextIrmaaCliff,
  irmaaTopTierVintage,
} from "@/lib/config/irmaa-tables";
import { growIrmaaBrackets } from "@/lib/pure/engine/bracket-growth";
import { engineHousehold } from "../fixtures/answer-key-household";
import { shippedTaxTables } from "../helpers/tax-data";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

// ---------------------------------------------------------------------------
// The surcharge per enrolled person, a year, on a premium year's table
// ---------------------------------------------------------------------------

const irmaa = (
  magi: number,
  status: ReturnFilingStatus,
  premiumYear: 2025 | 2026 = 2026,
) => getIrmaaCost(magi, status, shippedTaxTables(premiumYear).irmaaBrackets);

const nextCliff = (magi: number, status: ReturnFilingStatus) =>
  getNextIrmaaCliff(magi, status, shippedTaxTables(2026).irmaaBrackets);

// ---------------------------------------------------------------------------
// A. Single, 2026: every tier edge
// ---------------------------------------------------------------------------

describe("answer key: IRMAA tiers, Single, 2026 (CMS26)", () => {
  it("ret/I1 [RET-14] MAGI exactly 109,000: 0 (the first tier is greater than 109,000)", () => {
    // 418.1115(b)(1): no adjustment at "less than or equal to" 109,000.
    // Audit RT30 (`>` → `>=` on the lower tiers) fails here.
    cents(irmaa(109_000, "Single"), 0);
  });

  it("ret/I1:cliff [RET-14] at 109,000 the next cliff is 109,000 itself: one more dollar is charged (RT31)", () => {
    // The most MAGI that stays untaxed is the threshold, so a conversion
    // capped at the cliff may add 0 here. Audit RT31 (`<=` → `<` in
    // getNextIrmaaCliff) answers 137,000 and lets a conversion reach the
    // first tier.
    expect(nextCliff(109_000, "Single")).toBe(109_000);
    expect(nextCliff(109_001, "Single")).toBe(137_000);
  });

  it("ret/I2 [RET-14] 109,001: 1,148.40 (95.70 a month)", () => {
    cents(irmaa(109_001, "Single"), 1148.4);
  });

  it("ret/I3 [RET-14] 137,000: still 1,148.40 (the second tier is greater than 137,000)", () => {
    cents(irmaa(137_000, "Single"), 1148.4);
  });

  it("ret/I4 [RET-14] 137,001: 2,884.80 (240.40 a month)", () => {
    cents(irmaa(137_001, "Single"), 2884.8);
  });

  it("ret/I5 [RET-14] 205,000: 4,620.00 (the third tier, 171,000 < MAGI ≤ 205,000; 385.00 a month)", () => {
    cents(irmaa(205_000, "Single"), 4620);
  });

  it("ret/I6 [RET-14] 205,001: 6,355.20 (529.60 a month)", () => {
    cents(irmaa(205_001, "Single"), 6355.2);
  });

  it("ret/I7 [RET-14] 499,999: 6,355.20 (the fourth tier runs to less than 500,000)", () => {
    cents(irmaa(499_999, "Single"), 6355.2);
  });

  it("ret/I8 [RET-14] 500,000: 6,936.00 (the top tier starts at its threshold; 578.00 a month)", () => {
    // 418.1115(b)(3)(v): the top tier is MAGI "greater than or equal to"
    // 500,000: 578.00 a month × 12 = 6,936.00.
    cents(irmaa(500_000, "Single"), 6936);
  });

  it("ret/I8:cliff [RET-14] below the top tier the most MAGI that stays under it is 499,999.99", () => {
    // The top tier starts at 500,000 itself, so the cliff a conversion may
    // reach is a cent below it; at 500,000 there is no cliff above.
    expect(nextCliff(499_999, "Single")).toBe(499_999.99);
    expect(nextCliff(500_000, "Single")).toBeNull();
  });

  it("ret/I15 [RET-14] head of household, 150,000: the individual table, 2,884.80", () => {
    // 418.1120(b): HOH is an individual return; 137,000 < 150,000 ≤
    // 171,000 is the second tier.
    cents(irmaa(150_000, "HOH"), 2884.8);
  });

  it("ret/I14 [RET-14] qualifying surviving spouse, 150,000: the individual table, 2,884.80", () => {
    // 418.1120(b): QSS uses the individual table, not the joint one (which
    // would charge 0 at 150,000); the second tier, as I15.
    cents(irmaa(150_000, "QSS"), 2884.8);
  });
});

// ---------------------------------------------------------------------------
// B. Married filing jointly, 2026: the joint edges and the count
// ---------------------------------------------------------------------------

describe("answer key: IRMAA tiers, married filing jointly, 2026 (CMS26)", () => {
  it("ret/I9 [RET-14] MAGI exactly 218,000: 0 (the first joint tier is greater than 218,000)", () => {
    // 418.1115(c)(1). RT30 fails here too.
    cents(irmaa(218_000, "MFJ"), 0);
  });

  it("ret/I9:cliff [RET-14] at 218,000 the next joint cliff is 218,000 itself (RT31)", () => {
    expect(nextCliff(218_000, "MFJ")).toBe(218_000);
    expect(nextCliff(218_001, "MFJ")).toBe(274_000);
  });

  it("ret/I10 [RET-16] 218,001, both enrolled: 1,148.40 each, 2,296.80 for the household", () => {
    // IM-4: both use the return's one MAGI; IM-5: each enrolled person
    // pays, 2 × 1,148.40.
    const each = irmaa(218_001, "MFJ");
    cents(each, 1148.4);
    cents(each * 2, 2296.8);
  });

  it("ret/I11 [RET-16] 218,001, one enrolled: 1,148.40 for the household", () => {
    // IM-5: only the enrolled spouse pays; the joint MAGI still sets the
    // tier.
    cents(irmaa(218_001, "MFJ") * 1, 1148.4);
  });

  it("ret/I12 [RET-14] 749,999: 6,355.20 each (the fourth joint tier runs to less than 750,000)", () => {
    cents(irmaa(749_999, "MFJ"), 6355.2);
  });

  it("ret/I13 [RET-14] 750,000: 6,936.00 each (the top joint tier starts at its threshold)", () => {
    // 418.1115(c)(3)(v): "greater than or equal to" 750,000: 6,936.00 each.
    cents(irmaa(750_000, "MFJ"), 6936);
  });
});

// ---------------------------------------------------------------------------
// B2. A year whose table hasn't shipped: the top tier is held through 2027
// ---------------------------------------------------------------------------

describe("answer key: the top tier's threshold before indexing starts", () => {
  it("ret/IM21:2027 [RET-16] 2027 premiums from the 2026 table at 3% inflation, Single 505,000: the top tier, 7,144.08", () => {
    // 42 USC 1395r(i)(5)(C) (spec IM-21): 500,000 and 750,000 aren't
    // indexed before 2028, so a 2027 premium year keeps 500,000 while the
    // lower thresholds grow (205,000 × 1.03 = 211,150). 505,000 ≥ 500,000
    // is the top tier; Ledgr grows the surcharge with inflation like every
    // other tier: 6,936.00 × 1.03 = 7,144.08. Growing the top threshold too
    // (515,000) would put 505,000 in the fourth tier, 6,355.20 × 1.03 =
    // 6,545.86.
    const tables = shippedTaxTables(2026).irmaaBrackets;
    const vintage = irmaaTopTierVintage(2026);
    expect(vintage).toBe(2027);
    const topGrowth = Math.pow(1.03, Math.max(0, 2027 - vintage!));
    const grown = growIrmaaBrackets(tables, 1.03, topGrowth);
    cents(getIrmaaCost(505_000, "Single", grown), 7144.08);
    // From 2028 the top tier indexes from 2027's: a 2027 table grows it
    // like the rest, and a current table (no year) doesn't grow at all.
    expect(irmaaTopTierVintage(2028)).toBe(2028);
    expect(irmaaTopTierVintage(undefined)).toBeUndefined();
  });

  it("through the engine: a 2027 year read from the 2026 table keeps the top threshold at 500,000", () => {
    // Single, 69 in 2027, 3% inflation, the 2026 tables: the year's own
    // MAGI (no lookback yet) is its IRA draw, between 500,000 and 515,000.
    const year = runOneYear(
      {
        ...engineHousehold({
          status: "Single",
          people: [{ birthYear: 1958 }],
          traditionalIra: 10_000_000,
          spending: 355_000,
          endYear: 2028,
        }),
        inflationRate: 0.03,
      },
      2027,
    );
    if (year.phase !== "decumulation") throw new Error("not retired");
    expect(year.totalTraditionalWithdrawal).toBeGreaterThanOrEqual(500_000);
    expect(year.totalTraditionalWithdrawal).toBeLessThan(515_000);
    cents(year.irmaaCost, 7144.08);
  });
});

// ---------------------------------------------------------------------------
// B3. A stored table without the top tier: every tier is ordinary
// ---------------------------------------------------------------------------

describe("answer key: a table without the top tier", () => {
  // The top tier is the $500,000 / $750,000 row (20 CFR 418.1115(b)(5),
  // (c)(5)); a table a user stored without it (or an older year's) has only
  // "greater than" tiers that index each year (42 USC 1395r(i)(5)(A)).
  const fourTiers = () => {
    const shipped = shippedTaxTables(2026).irmaaBrackets;
    return {
      Single: shipped.Single!.filter((b) => b.magiThreshold < 500_000),
      MFJ: shipped.MFJ!.filter((b) => b.magiThreshold < 750_000),
    };
  };

  it("ret/IM21:no-top-row [RET-16] 2027 premiums from the 2026 Single table without its top row, 3%, MAGI 208,000: the third tier, 4,758.60", () => {
    // 171,000 × 1.03 = 176,130 < 208,000 ≤ 205,000 × 1.03 = 211,150: the
    // third tier, 4,620.00 × 1.03 = 4,758.60. Holding 205,000 as if it were
    // the top tier charged the fourth, 6,355.20 × 1.03 = 6,545.86.
    const grown = growIrmaaBrackets(fourTiers(), 1.03, 1);
    cents(getIrmaaCost(208_000, "Single", grown), 4758.6);
    // The next cliff is the grown fourth threshold itself, not a cent under.
    cents(getNextIrmaaCliff(208_000, "Single", grown)!, 211_150);
  });

  it("ret/IM7:no-top-row [RET-14] the last row starts above its threshold: Single 205,000 pays the third tier, 4,620.00", () => {
    cents(getIrmaaCost(205_000, "Single", fourTiers()), 4620);
    cents(getIrmaaCost(205_001, "Single", fourTiers()), 6355.2);
    cents(getNextIrmaaCliff(200_000, "Single", fourTiers())!, 205_000);
    expect(getNextIrmaaCliff(205_001, "Single", fourTiers())).toBeNull();
  });

  it("ret/IM21:grown-ordinary [RET-16] a grown table keeps each row's tier: an ordinary last row grown past 750,000 still starts above it", () => {
    // MFJ without its top row, grown ×2: 410,000 → 820,000, still ordinary.
    const grown = growIrmaaBrackets(fourTiers(), 2, 1);
    cents(getIrmaaCost(820_000, "MFJ", grown), 4620 * 2);
    cents(getNextIrmaaCliff(800_000, "MFJ", grown)!, 820_000);
  });

  it("ret/IM21:grown-deflation [RET-16] a grown statutory table keeps its top tier when it grows below the floor", () => {
    // A Simulation trial's deflation (×0.9): 750,000 → 675,000, still the top
    // tier, at or above it: 6,936.00 × 0.95.
    const grown = growIrmaaBrackets(
      shippedTaxTables(2026).irmaaBrackets,
      0.95,
      0.9,
    );
    cents(getIrmaaCost(675_000, "MFJ", grown), 6936 * 0.95);
    cents(getNextIrmaaCliff(600_000, "MFJ", grown)!, 674_999.99);
  });
});

// ---------------------------------------------------------------------------
// C. 2025's table, and the MAGI IRMAA reads
// ---------------------------------------------------------------------------

describe("answer key: the 2025 table and IRMAA's MAGI", () => {
  it("ret/I21 [RET-14] 2025 premiums, Single 106,001: 1,052.40 (CMS25: 74.00 + 13.70 a month)", () => {
    cents(irmaa(106_001, "Single", 2025), 1052.4);
  });

  it("ret/I23 [RET-14] MFJ AGI 215,000 plus 4,000 of municipal-bond interest: MAGI 219,000, 1,148.40 each", () => {
    // IM-3: MAGI adds tax-exempt interest back: 215,000 + 4,000 = 219,000
    // > 218,000. Ledgr has no tax-exempt-interest input, so the MAGI is
    // composed here and the case checks the tier it lands in.
    cents(irmaa(215_000 + 4_000, "MFJ"), 1148.4);
  });

  it("ret/I24 [RET-14] Single AGI 100,000 with 15,000 of nontaxable Social Security: MAGI 100,000, 0", () => {
    // IM-3: nontaxable Social Security isn't added (it is for the ACA,
    // ret/A26). Adding it would give 115,000 and 1,148.40.
    cents(irmaa(100_000, "Single"), 0);
  });
});

// ---------------------------------------------------------------------------
// D. The lookback: premium year Y reads Y−2
// ---------------------------------------------------------------------------

describe("answer key: the two-year lookback", () => {
  it("ret/I26 [RET-16] 2026 premiums from 2024 MAGI 300,000 MFJ: 2,884.80", () => {
    // IM-2: 2024 is Y−2 for 2026; 274,000 < 300,000 ≤ 342,000 on the 2026
    // joint table is the second tier.
    cents(irmaa(300_000, "MFJ", 2026), 2884.8);
  });

  it("ret/I27 [RET-16] retired 2025, 2024 MFJ 300,000: 2,884.80 as filed; 0 only once a request is granted (IM-15)", () => {
    // A plan computes as filed (IM-15): 2024's 300,000, the second tier.
    cents(irmaa(300_000, "MFJ", 2026), 2884.8);
    // On an SSA-44 request (work stoppage, 418.1205(d)), 2026's estimate of
    // 120,000 replaces it (418.1225): ≤ 218,000, so 0. Never assumed.
    cents(irmaa(120_000, "MFJ", 2026), 0);
  });

  it("ret/I28 [RET-16] spouse died 2025, 2024 joint 200,000, survivor Single 130,000 in 2026: 2026 0, 2028 1,148.40", () => {
    // 2026 premiums read 2024, a joint return of 200,000 ≤ 218,000: 0.
    cents(irmaa(200_000, "MFJ", 2026), 0);
    // 2028 premiums read 2026, a Single return of 130,000: 109,000 <
    // 130,000 ≤ 137,000 on the 2026 table (the spec's case reads 2028 on
    // it; no 2028 table exists): 1,148.40.
    cents(irmaa(130_000, "Single", 2026), 1148.4);
  });

  it("ret/I29 [RET-16] 2024 conversion of 100,000 on a Single base of 60,000: 2026 premiums 2,884.80", () => {
    // 2024 MAGI 60,000 + 100,000 = 160,000: 137,000 < 160,000 ≤ 171,000.
    cents(irmaa(60_000 + 100_000, "Single", 2026), 2884.8);
  });

  it("ret/I30 [RET-16] 65 in 2026, 2024 wages 300,000 MFJ: 2,884.80 (the lookback still counts in the first enrolled year)", () => {
    // IM-16: the Y−2 income is looked at when enrollment starts.
    cents(irmaa(300_000, "MFJ", 2026), 2884.8);
  });

  it("ret/I30:count [RET-16] through the engine: a couple 65 and 64 in 2026 is charged once (RT35)", () => {
    // Invented: A born 1961 (65 in 2026) and B born 1962 (64), MFJ, retired,
    // spending 260,000 from A's Traditional IRA, no Social Security, IRMAA
    // awareness on (the 2026 tables, 0% inflation).
    //
    // MAGI is the year's IRA draw W (the first plan year has no lookback
    // yet, so the engine reads that year's own MAGI). Deductions: 32,200
    // standard + 1,650 for A at 65 (Rev. Proc. 2025-32 § 4.14(1), (3)); the
    // senior 6,000 is gone (6% of MAGI over 150,000 > 6,000). On 2026's
    // joint brackets (§ 4.01 Table 1: 10% to 24,800, 12% to 100,800, 22% to
    // 211,400, 24% to 403,550) the tax is
    // 0.24 × (W − 33,850) − 14,804, and W − tax = 260,000 gives W =
    // 311,936.84: 274,000 < W ≤ 342,000, the second joint tier, 2,884.80 a
    // person. Only A is enrolled (IM-5; Medicare from 65, 42 USC
    // 426(a)), so the household pays 2,884.80, not 5,769.60. RT35 (Medicare
    // counted from 66) gives 0.
    const year = runOneYear(
      {
        ...engineHousehold({
          status: "MFJ",
          people: [{ birthYear: 1961 }, { birthYear: 1962 }],
          traditionalIra: 3_000_000,
          spending: 260_000,
          endYear: 2027,
        }),
        enableIrmaaAwareness: true,
      },
      2026,
    );
    expect(year.phase).toBe("decumulation");
    if (year.phase !== "decumulation") return;
    cents(year.irmaaCost, 2884.8);
  });

  it("ret/I30:engine [RET-16] through the engine: the first two retired years read the working years' wages", () => {
    // Invented: Single, born 1962, paid 300,000 a year through 2027 (no
    // pre-tax deferrals, so AGI = MAGI = 300,000), retired from 2028 (66),
    // spending 60,000 from a Traditional IRA, no Social Security, the 2026
    // tables at 0% inflation, the surcharge on top of the budget.
    //
    // IM-2 and IM-16 (1395r(i)(4)(B)(i), 418.1135(a)): 2028 reads 2026 and
    // 2029 reads 2027, both working years: 205,000 < 300,000 < 500,000 is
    // the individual table's fourth tier, (446.30 + 83.30) × 12 =
    // 6,355.20. 2030 reads 2028, whose MAGI is its IRA draw: spending
    // 60,000 plus the 6,355.20 on top, grossed up for tax, is far below
    // 109,000, so 0. On top of the budget, a surcharge joins the year's
    // need (decision E1): 2028's after-tax need is 60,000 + 6,355.20.
    const years = calculateProjection({
      ...engineHousehold({
        status: "Single",
        people: [{ birthYear: 1962, job: { salary: 300_000, lastYear: 2027 } }],
        traditionalIra: 1_000_000,
        spending: 60_000,
        endYear: 2031,
      }),
      irmaaOnTopOfBudget: true,
    }).projectionByYear;
    const retired = (y: number) => {
      const row = years.find((r) => r.year === y);
      if (row?.phase !== "decumulation") throw new Error(`${y} not retired`);
      return row;
    };
    cents(retired(2028).irmaaCost, 6355.2);
    cents(retired(2028).irmaaPaid ?? Number.NaN, 6355.2);
    cents(retired(2028).afterTaxNeed, 66_355.2);
    cents(retired(2029).irmaaCost, 6355.2);
    expect(retired(2028).totalTraditionalWithdrawal).toBeLessThan(109_000);
    cents(retired(2030).irmaaCost, 0);
  });

  it("ret/I30:gap [RET-16] through the engine: a gap year's tax year holds the retired spouse's Social Security as well as the other's wages", () => {
    // Invented: MFJ. A, born 1959, stopped work before 2026 and claims
    // 40,000 a year of Social Security; B, born 1962, is paid 200,000 a
    // year through 2027 (no pre-tax deferrals); spending 100,000, which pay
    // and Social Security cover, so no gap-year draw; 2026 tables, 0%
    // inflation and COLA; the surcharge on top.
    //
    // 2026 and 2027 are gap years. Their MAGI (418.1010): wages 200,000
    // plus taxable Social Security, 85% of 40,000 = 34,000 (provisional
    // income far over 44,000, IRC 86(a)(2)) = 234,000, over the joint
    // first tier's 218,000 and under 274,000: 1,148.40 a person. 2028 and
    // 2029 read 2026 and 2027 with both 65+: 2 × 1,148.40 = 2,296.80
    // (reading the wages alone, 200,000, would charge nothing).
    const years = calculateProjection({
      ...engineHousehold({
        status: "MFJ",
        people: [
          {
            birthYear: 1959,
            socialSecurity: 40_000,
            job: { salary: 0, lastYear: 2025 },
          },
          { birthYear: 1962, job: { salary: 200_000, lastYear: 2027 } },
        ],
        traditionalIra: 1_000_000,
        spending: 100_000,
        endYear: 2031,
      }),
      irmaaOnTopOfBudget: true,
    }).projectionByYear;
    const retired = (y: number) => {
      const row = years.find((r) => r.year === y);
      if (row?.phase !== "decumulation") throw new Error(`${y} not retired`);
      return row;
    };
    cents(retired(2028).irmaaCost, 2296.8);
    cents(retired(2029).irmaaCost, 2296.8);
  });
});

// ---------------------------------------------------------------------------
// E. Blocked on a feature
// ---------------------------------------------------------------------------

describe("answer key: IRMAA cases blocked on a feature", () => {
  // Inputs and figures for each are in the spec's § 14.8 and § 14.1.
  // I25: Single 150,000 enrolled in Part B only: 202.90 × 12 = 2,434.80
  // (Ledgr charges B + D, 2,884.80; verdict K-G).
  const PREMIUM_INPUT =
    'v0.11 Tax "Absent rules to confirm in specs" (decision E6: optional Part B/D premium input)';
  it.todo(`ret/I25: blocked on ${PREMIUM_INPUT}`);
  // I31, I32: base premiums for a full year, Part B 2,434.80 / 2,220.00
  // and the Part D reference 467.88 / 441.36 (2026 / 2025); I33, I34: the
  // Part D IRMAA formula at 35% and 85% (14.50, 91.00); P26: the 2027 Part
  // D base premium, 41.33. Ledgr holds no base premiums.
  it.todo(`ret/I31: blocked on ${PREMIUM_INPUT}`);
  it.todo(`ret/I32: blocked on ${PREMIUM_INPUT}`);
  it.todo(`ret/I33: blocked on ${PREMIUM_INPUT}`);
  it.todo(`ret/I34: blocked on ${PREMIUM_INPUT}`);
  it.todo(`ret/P26: blocked on ${PREMIUM_INPUT}`);
});
