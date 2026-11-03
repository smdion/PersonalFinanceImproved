/**
 * Answer key, tax (engine years): one projected year's tax, deductions and
 * withdrawal through `calculateProjection`, each figure worked by hand from
 * the published rules with its working beside it. Source of the cases: the
 * November review's tax verdicts (`rebuild/annual-tax-verdicts.md` § 3 and
 * "Cases ready to become answer-key tests") and spec
 * (`specs/annual-tax.md`), as collected in the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Tax, Expected failures, and §
 * "Re-run on `24bae33b`").
 *
 * Households: `tests/fixtures/answer-key-household.ts` (invented; flat 0%
 * return and inflation, so the 2026 tables hold in every year). 2026
 * figures (Rev. Proc. 2025-32): basic standard deduction 16,100 Single,
 * 32,200 MFJ (§ 4.14); 65+ add-on 2,050 unmarried, 1,650 married; rate
 * schedules § 4.01 Tables 1 (MFJ: 10% to 24,800, 12% to 100,800, 22% to
 * 211,400, 24% to 403,550) and 3 (Single: 10% to 12,400, 12% to 50,400,
 * 22% to 105,700); gains 0% to 98,900 MFJ, 49,450 Single (§ 4.03). Senior
 * deduction (IRC 151(d)(5)(C); Schedule 1-A lines 31-37): 6,000 a person
 * 65+, each reduced by 6% of the return's MAGI over 75,000 (150,000
 * joint), from the same return's AGI (S1A line 1; spec ORD-4, SR-5 to
 * SR-8), 2025-2028 only.
 *
 * How the cases are set. The engine takes a year's spending, not its
 * draw: the draw W grosses up until W − tax = need (withdrawal-sized
 * cases) or is the RMD when that's larger. Each case sets need = the
 * key's W − the key's decided tax, so the fixed code lands exactly on the
 * key's figures; today's code, on the same household, lands on a slightly
 * different W, worked here by solving W = need + tax(W) under today's rule
 * (the key's "Today" is today's tax at the key's W, a different input:
 * quoted in each comment). The engine reports `standardDeduction` as the
 * whole deduction: line 12e (basic + add-ons) plus the senior amount
 * (line 13b). Withdrawal-sized figures are ±$1: the gross-up stops within
 * a cent of the need and the tax carries it (key § Re-run: "single-year W
 * at ±$1").
 */
import { describe, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import {
  gapYear,
  retiredYear,
  type KeyHousehold,
} from "../fixtures/answer-key-household";

/** Gross-up convergence, carried into the tax (see the header). */
const GROSS_UP = 1;

const UNUSED_DEDUCTION = `v0.11 Tax "Unused standard deduction never shelters gains"`;
const PER_PERSON = `v0.11 Tax "Senior deduction phases out against the combined amount"`;
const SAME_YEAR_MAGI = `v0.11 Tax "Senior deduction must use same-year MAGI in every year"`;
const ONE_RETURN_DEDUCTIONS = `v0.11 Tax "One returnDeductions()"`;
const GAP_YEARS = `v0.11 Tax "Gap years have no 65+ deductions"`;

/** One year's draw, tax and whole deduction. */
function year(h: KeyHousehold, y: number) {
  return () => {
    const r = retiredYear(h, y);
    return {
      withdrawal: r.totalWithdrawal,
      tax: r.taxCost,
      deductions: r.standardDeduction ?? NaN,
    };
  };
}

/** Both people (or the one) born `birthYear`, a Traditional IRA. */
const retirees = (
  status: KeyHousehold["status"],
  birthYear: number,
  spending: number,
  extra: Partial<KeyHousehold> = {},
): KeyHousehold => ({
  status,
  people: status === "MFJ" ? [{ birthYear }, { birthYear }] : [{ birthYear }],
  traditionalIra: 5_000_000,
  spending,
  endYear: 2029,
  ...extra,
});

describe("answer key: gains in an engine year", () => {
  describe("tax/G2-MFJ [TAX-16]", () => {
    // 2026 MFJ, both 56: a $120,000 gain, nothing else (brokerage, basis
    // 0, so the draw is all gain). Decided (spec LT-3; F1040 line 15; QDCG
    // lines 1, 5, 10): TI = 120,000 − 32,200 = 87,800, all gains, under
    // the 98,900 0% top: tax 0, so need = 120,000 and W = 120,000. Today
    // the ordinary part is clamped at 0 and every gain dollar is stacked
    // from 0: tax = 15% × (W − 98,900) (key: 3,165 at W 120,000); W =
    // 120,000 + 0.15W − 14,835 → W = 105,165 / 0.85 = 123,723.53, tax
    // 3,723.53.
    xfail({
      id: "tax/G2-MFJ [TAX-16]",
      todo: UNUSED_DEDUCTION,
      run: () => {
        const r = retiredYear(
          {
            status: "MFJ",
            people: [{ birthYear: 1970 }, { birthYear: 1970 }],
            brokerage: { balance: 5_000_000, basis: 0 },
            spending: 120_000,
            endYear: 2028,
          },
          2026,
        );
        return { withdrawal: r.totalWithdrawal, tax: r.taxCost };
      },
      expected: { withdrawal: 120_000, tax: 0 },
      today: { withdrawal: 123_723.53, tax: 3_723.53 },
      tolerance: GROSS_UP,
    });
  });
});

describe("answer key: the senior deduction in an engine year", () => {
  // Steady MFJ cases, both born 1958 (68 in 2026; no RMD before 2031),
  // read in 2028, the senior deduction's last year, once today's
  // prior-year MAGI has settled. Today's rule: no senior amount in the
  // first retired year (2026), then a pooled 12,000 − 6% × (last year's
  // MAGI − 150,000) (`obbba-senior-deduction.ts:78`,
  // `decumulation-year.ts:478`).

  describe("tax/MFJ-200k [TAX-22]", () => {
    // Decided at W 200,000 (MAGI = AGI = W): senior 2 × (6,000 − 6% ×
    // 50,000) = 6,000 (Schedule 1-A lines 35, 36a, 36b); deductions
    // 35,500 + 6,000 = 41,500; TI 158,500; tax = 11,600 (at 100,800) +
    // 22% × 57,700 = 24,294. Need = 200,000 − 24,294 = 175,706.
    // Today (key: 23,634 at W 200,000), tax = 11,600 + 22% × (W − 35,500
    // − senior − 100,800): 2026, no senior: W = (175,706 − 18,386) / 0.78
    // = 201,692.31. 2027, senior 12,000 − 6% × 51,692.31 = 8,898.46: W =
    // 199,182.49. 2028, senior 12,000 − 6% × 49,182.49 = 9,049.05:
    // deductions 44,549.05, tax = 0.22W − 20,376.79, W = 155,329.21 / 0.78
    // = 199,140.01, tax 23,434.01. Both fixes are needed: with the
    // per-person rule alone the prior-year MAGI leaves 2028 at W
    // 200,001.94 (outside ±1).
    xfail({
      id: "tax/MFJ-200k [TAX-22]",
      todo: `${ONE_RETURN_DEDUCTIONS} (with "Senior deduction phases out against the combined amount" and "Senior deduction must use same-year MAGI in every year")`,
      run: year(retirees("MFJ", 1958, 175_706), 2028),
      expected: { withdrawal: 200_000, tax: 24_294, deductions: 41_500 },
      today: {
        withdrawal: 199_140.01,
        tax: 23_434.01,
        deductions: 44_549.05,
      },
      tolerance: GROSS_UP,
    });
  });

  describe("tax/MFJ-260k [TAX-22]", () => {
    // Decided at W 260,000: 6% × 110,000 = 6,600 takes each 6,000 to 0
    // (gone at 250,000 joint, spec SR-8); deductions 35,500; TI 224,500;
    // tax = 35,932 (at 211,400) + 24% × 13,100 = 39,076. Need = 260,000 −
    // 39,076 = 220,924. Today (key: 37,780 at W 260,000), tax = 35,932 +
    // 24% × (W − 35,500 − senior − 211,400): 2026, no senior: W =
    // (220,924 − 23,324) / 0.76 = 260,000. 2027, pooled 12,000 − 6% ×
    // 110,000 = 5,400: W = 258,294.74. 2028, 12,000 − 6% × 108,294.74 =
    // 5,502.32: deductions 41,002.32, W = (220,924 − 24,644.56) / 0.76 =
    // 258,262.42, tax 37,338.42. (The per-person rule alone fixes this
    // one: its MAGI never falls under 250,000.)
    xfail({
      id: "tax/MFJ-260k [TAX-22]",
      todo: PER_PERSON,
      run: year(retirees("MFJ", 1958, 220_924), 2028),
      expected: { withdrawal: 260_000, tax: 39_076, deductions: 35_500 },
      today: {
        withdrawal: 258_262.42,
        tax: 37_338.42,
        deductions: 41_002.32,
      },
      tolerance: GROSS_UP,
    });
  });

  // First retired year: the senior amount reads this year's MAGI (S1A
  // line 1 is the same return's AGI, spec ORD-4); today it's 0.

  describe("tax/S70-50k [TAX-22]", () => {
    // 2026 Single, born 1956 (70). Decided at W 50,000: deductions 16,100
    // + 2,050 + 6,000 (MAGI under 75,000) = 24,150; TI 25,850; tax =
    // 1,240 + 12% × 13,450 = 2,854. Need = 47,146. Today (key: 3,574 at W
    // 50,000): deductions 18,150, tax = 1,240 + 12% × (W − 30,550) =
    // 0.12W − 2,426; W = 44,720 / 0.88 = 50,818.18, tax 3,672.18.
    xfail({
      id: "tax/S70-50k [TAX-22]",
      todo: SAME_YEAR_MAGI,
      run: year(retirees("Single", 1956, 47_146), 2026),
      expected: { withdrawal: 50_000, tax: 2_854, deductions: 24_150 },
      today: { withdrawal: 50_818.18, tax: 3_672.18, deductions: 18_150 },
      tolerance: GROSS_UP,
    });
  });

  describe("tax/MFJ69-100k [TAX-22]", () => {
    // 2026 MFJ, both born 1957 (69). Decided at W 100,000: deductions
    // 35,500 + 2 × 6,000 = 47,500 (MAGI under 150,000); TI 52,500; tax =
    // 2,480 + 12% × 27,700 = 5,804. Need = 94,196. Today (key: 7,244 at W
    // 100,000): deductions 35,500, tax = 2,480 + 12% × (W − 60,300) =
    // 0.12W − 4,756; W = 89,440 / 0.88 = 101,636.36, tax 7,440.36.
    xfail({
      id: "tax/MFJ69-100k [TAX-22]",
      todo: SAME_YEAR_MAGI,
      run: year(retirees("MFJ", 1957, 94_196), 2026),
      expected: { withdrawal: 100_000, tax: 5_804, deductions: 47_500 },
      today: { withdrawal: 101_636.36, tax: 7_440.36, deductions: 35_500 },
      tolerance: GROSS_UP,
    });
  });

  // A changing draw: 2027's senior amount reads 2027's MAGI, not 2026's.
  // Single, born 1957 (69 in 2026, 70 in 2027). Decided 2027 at W 100,000:
  // senior 6,000 − 6% × 25,000 = 4,500; deductions 18,150 + 4,500 =
  // 22,650; TI 77,350; tax = 5,800 (at 50,400) + 22% × 26,950 = 11,729.
  // 2027 need = 100,000 − 11,729 = 88,271 (a typed budget from 2027:
  // 88,271 / 12 a month).

  describe("tax/S69-down [TAX-22]", () => {
    // 2026 at W 120,000, decided: senior 6,000 − 6% × 45,000 = 3,300; TI
    // 120,000 − 21,450 = 98,550; tax 5,800 + 22% × 48,150 = 16,393: need
    // 103,607. Today (key: 11,993 at W 100,000 after 120,000): 2026 no
    // senior, tax = 5,800 + 22% × (W − 68,550) = 0.22W − 9,281, W =
    // 94,326 / 0.78 = 120,930.77. 2027 senior from that MAGI: 6,000 − 6%
    // × 45,930.77 = 3,244.15; deductions 21,394.15; tax = 0.22W −
    // 9,994.71, W = 78,276.29 / 0.78 = 100,354.22, tax 12,083.22.
    xfail({
      id: "tax/S69-down [TAX-22]",
      todo: SAME_YEAR_MAGI,
      run: year(
        retirees("Single", 1957, 103_607, {
          budgetFrom: [{ year: 2027, monthly: 88_271 / 12 }],
        }),
        2027,
      ),
      expected: { withdrawal: 100_000, tax: 11_729, deductions: 22_650 },
      today: {
        withdrawal: 100_354.22,
        tax: 12_083.22,
        deductions: 21_394.15,
      },
      tolerance: GROSS_UP,
    });
  });

  describe("tax/S69-up [TAX-22]", () => {
    // 2026 at W 80,000, decided: senior 6,000 − 6% × 5,000 = 5,700; TI
    // 80,000 − 23,850 = 56,150; tax 5,800 + 22% × 5,750 = 7,065: need
    // 72,935. Today (key: 11,465 at W 100,000 after 80,000): 2026 no
    // senior, tax = 0.22W − 9,281, W = 63,654 / 0.78 = 81,607.69. 2027
    // senior 6,000 − 6% × 6,607.69 = 5,603.54; deductions 23,753.54; tax
    // = 5,800 + 22% × (W − 74,153.54) = 0.22W − 10,513.78, W = 77,757.22
    // / 0.78 = 99,688.74, tax 11,417.74.
    xfail({
      id: "tax/S69-up [TAX-22]",
      todo: SAME_YEAR_MAGI,
      run: year(
        retirees("Single", 1957, 72_935, {
          budgetFrom: [{ year: 2027, monthly: 88_271 / 12 }],
        }),
        2027,
      ),
      expected: { withdrawal: 100_000, tax: 11_729, deductions: 22_650 },
      today: {
        withdrawal: 99_688.74,
        tax: 11_417.74,
        deductions: 23_753.54,
      },
      tolerance: GROSS_UP,
    });
  });
});

describe("answer key: whose deductions an engine year counts", () => {
  describe("tax/GAP-2028 [TAX-21]", () => {
    // 2028 MFJ gap year. A, born 1958 (70), retired (a $0 job ended
    // 2025), Social Security 40,000; B, born 1968 (60), working, wages
    // 60,000 to 2028-12-31; spending 100,000. The engine taxes the year's
    // income before the draw (`taxOnIncome`, with payroll tax): wages +
    // taxable SS on wages alone. Pub 915 Worksheet 1: L2 20,000; L8
    // 80,000; L10 48,000; L12 36,000; L15 = min(20,000, 6,000) = 6,000;
    // L16 30,600; L17 36,600 > L18 34,000: taxable 34,000. Income 94,000.
    // Decided (spec SD-1, SR-2): 32,200 + 1,650 (A only) + 6,000 (A's
    // senior; MAGI under 150,000 even with the draw) = 39,850; TI 54,150;
    // tax = 2,480 + 12% × 29,350 = 6,002. Today (key): 32,200 only; TI
    // 61,800; 2,480 + 12% × 37,000 = 6,920. Payroll tax on B's 60,000:
    // 6.2% + 1.45% = 4,590 (IRC 3101(a), (b)(1); under the wage base), so
    // `taxOnIncome` is 10,592 decided, 11,510 today.
    xfail({
      id: "tax/GAP-2028 [TAX-21]",
      todo: GAP_YEARS,
      run: () => {
        const r = gapYear(
          {
            status: "MFJ",
            people: [
              {
                birthYear: 1958,
                socialSecurity: 40_000,
                job: { salary: 0, lastYear: 2025 },
              },
              { birthYear: 1968, job: { salary: 60_000, lastYear: 2028 } },
            ],
            traditionalIra: 2_000_000,
            spending: 100_000,
            endYear: 2030,
          },
          2028,
        );
        return { taxOnIncome: r.gapDraw.taxOnIncome };
      },
      expected: { taxOnIncome: 6_002 + 4_590 },
      today: { taxOnIncome: 6_920 + 4_590 },
    });
  });

  describe("tax/TWO-65 [TAX-21]", () => {
    // 2026 Single return, two household people born 1950 (76). One
    // return, one filer: one add-on (i1040 p.35 chart; IRC
    // 151(d)(5)(C)(ii)): line 12e 16,100 + 2,050 = 18,150 (key). A's IRA
    // 2,000,000: the RMD, 2,000,000 / 23.7 (Pub 590-B Table III, age 76)
    // = 84,388.19, is more than spending 60,000 + tax, so W = RMD and the
    // rest is reinvested. Same-year MAGI 84,388.19: senior 6,000 − 6% ×
    // 9,388.19 = 5,436.71; deductions 23,586.71; TI 60,801.48; tax =
    // 5,800 + 22% × 10,401.48 = 8,088.33. Today (key): two add-ons, 20,200,
    // and no senior amount in the first year; TI 64,188.19; tax 5,800 +
    // 22% × 13,788.19 = 8,833.40. The decided figure needs the same-year
    // MAGI as well as one return's add-ons.
    xfail({
      id: "tax/TWO-65 [TAX-21]",
      todo: `${ONE_RETURN_DEDUCTIONS} (with "Gap years have no 65+ deductions": two people 65+ on a Single return; and same-year MAGI)`,
      run: year(
        {
          status: "Single",
          people: [{ birthYear: 1950 }, { birthYear: 1950 }],
          traditionalIra: 2_000_000,
          spending: 60_000,
          endYear: 2027,
        },
        2026,
      ),
      expected: { withdrawal: 84_388.19, tax: 8_088.33, deductions: 23_586.71 },
      today: { withdrawal: 84_388.19, tax: 8_833.4, deductions: 20_200 },
      tolerance: GROSS_UP,
    });
  });

  // A person is 65 for year Y if born before January 2 of Y − 64 (they
  // reach 65 the day before the birthday; i1040 pp.35, 110; spec SD-2):
  // for 2026, born before 1962-01-02. The engine takes the birth year only
  // (`perPersonBirthYears`), so D6 and D7 are the same input today; the fix
  // passes the date (`build-engine-payload.ts:1340`). Single, IRA
  // 1,000,000, spending 40,000.

  describe("tax/D6 [TAX-21]", () => {
    // Born 1962-01-01: 65 in 2026. Decided: 16,100 + 2,050 = 18,150
    // (line 12e, key) + senior 6,000 (MAGI under 75,000) = 24,150; tax =
    // 1,240 + 12% × (W − 36,550) = 0.12W − 3,146; W = 36,854 / 0.88 =
    // 41,879.55, tax 1,879.55. Today: 64, deductions 16,100 (key); tax =
    // 0.12W − 2,180; W = 37,820 / 0.88 = 42,977.27, tax 2,977.27.
    xfail({
      id: "tax/D6 [TAX-21]",
      todo: `${ONE_RETURN_DEDUCTIONS} (with "Gap years have no 65+ deductions": January 1 birthday; and same-year MAGI)`,
      run: year(
        retirees("Single", 1962, 40_000, {
          traditionalIra: 1_000_000,
          endYear: 2027,
        }),
        2026,
      ),
      expected: { withdrawal: 41_879.55, tax: 1_879.55, deductions: 24_150 },
      today: { withdrawal: 42_977.27, tax: 2_977.27, deductions: 16_100 },
      tolerance: GROSS_UP,
    });
  });

  it("tax/D7 [TAX-21] January 2 birthday isn't 65 in 2026: 16,100", () => {
    // Born 1962-01-02: 65 on 2027-01-01, so not in 2026: no add-on and no
    // senior amount, decided and today alike (passes today; kept beside D6
    // so the pair moves together). Deductions 16,100; tax = 1,240 + 12% ×
    // (W − 28,500) = 0.12W − 2,180; W = 37,820 / 0.88 = 42,977.27, tax
    // 2,977.27.
    cents(
      year(
        retirees("Single", 1962, 40_000, {
          traditionalIra: 1_000_000,
          endYear: 2027,
        }),
        2026,
      )(),
      { withdrawal: 42_977.27, tax: 2_977.27, deductions: 16_100 },
      GROSS_UP,
    );
  });
});
