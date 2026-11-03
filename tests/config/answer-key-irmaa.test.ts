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
import { cents, runOneYear, xfail } from "../fixtures/answer-key";
import { getIrmaaCost, getNextIrmaaCliff } from "@/lib/config/irmaa-tables";
import { engineHousehold } from "../fixtures/answer-key-household";
import { shippedTaxTables } from "../helpers/tax-data";
import type { FilingStatusType } from "@/lib/calculators/types";

// ---------------------------------------------------------------------------
// The surcharge per enrolled person, a year, on a premium year's table
// ---------------------------------------------------------------------------

const irmaa = (
  magi: number,
  status: FilingStatusType,
  premiumYear: 2025 | 2026 = 2026,
) => getIrmaaCost(magi, status, shippedTaxTables(premiumYear).irmaaBrackets);

const nextCliff = (magi: number, status: FilingStatusType) =>
  getNextIrmaaCliff(magi, status, shippedTaxTables(2026).irmaaBrackets);

/** The top tier compares with `>`, so MAGI exactly at 500,000 / 750,000
 *  lands a tier low (verdict K-D). The fix is placed in v0.10.x "Split
 *  IRMAA into Part B and D" and ships with v0.11's IRMAA items. */
const TOP_TIER =
  'v0.11 Retirement rules "top IRMAA tier grown until 2027.json ships" (verdict K-D: the top tier starts at its threshold)';

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

  describe("ret/I8 [RET-14]", () => {
    // 418.1115(b)(5): the top tier is MAGI "greater than or equal to"
    // 500,000: 578.00 a month × 12 = 6,936.00. Today the tier below,
    // 6,355.20 (580.80 a person short; spec "Wrong, reusing greater
    // than").
    xfail({
      id: "ret/I8 [RET-14]",
      todo: TOP_TIER,
      run: () => irmaa(500_000, "Single"),
      expected: 6936,
      today: 6355.2,
    });
  });

  it("ret/I15 [RET-14] head of household, 150,000: the individual table, 2,884.80", () => {
    // 418.1120(b): HOH is an individual return; 137,000 < 150,000 ≤
    // 171,000 is the second tier.
    cents(irmaa(150_000, "HOH"), 2884.8);
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

  describe("ret/I13 [RET-14]", () => {
    // 418.1115(c)(5): "greater than or equal to" 750,000: 6,936.00 each.
    xfail({
      id: "ret/I13 [RET-14]",
      todo: TOP_TIER,
      run: () => irmaa(750_000, "MFJ"),
      expected: 6936,
      today: 6355.2,
    });
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
  // I14: QSS 150,000, the individual table: 2,884.80 (no QSS status yet;
  // decision B2 adds QSS rows with QSS).
  it.todo(
    'ret/I14: blocked on v0.11 Retirement rules "Add: survivor benefit and first death" (QSS IRMAA, with the filing status rework)',
  );
});
