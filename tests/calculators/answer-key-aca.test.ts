/**
 * Answer key, retirement: the ACA premium tax credit cliff (400% of the
 * poverty line), the poverty line by family size, the income it reads and
 * the case of one spouse on Medicare (`.scratch/docs/drafts/answer-key.md`
 * § Retirement rules; rulings in `reviews/2026-11-01/rebuild/
 * retirement-verdicts.md`, rules and worked cases in
 * `reviews/2026-11-01/specs/retirement-rules.md` § 4.4, § 11 and § 14.9).
 * Ids are the spec's own, prefixed `ret/` (the same letters repeat in other
 * areas); the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the published rule, never read from
 * `src/`:
 * - HHS25: HHS, Annual Update of the HHS Poverty Guidelines, 90 FR 5917
 *   (Jan 17, 2025), 48 contiguous states and DC: 15,650 for one, 21,150
 *   for two, 32,150 for four, 54,150 for eight, 5,500 for each person over
 *   eight. Coverage year 2026 uses them (IRC 36B(d)(3)(B); Treas. Reg.
 *   1.36B-1(h): the guidelines most recently published before open
 *   enrollment; spec ACA-4).
 * - IRC 36B(c)(1)(A): an applicable taxpayer's household income is at
 *   least 100% and not more than 400% of the poverty line. The enhanced
 *   credit above 400% (36B(c)(1)(E)) ended with 2025, so in 2026 one dollar
 *   over 400% has no credit (ACA-2, ACA-10; Form 8962 instructions,
 *   Worksheet 2: "more than" 400%).
 * - IRC 36B(d)(2)(B); Reg. 1.36B-1(e): household income is MAGI = AGI +
 *   tax-exempt interest + Social Security not included in income, so all
 *   of the benefit counts (ACA-7); it is the whole year's (ACA-20).
 * - IRC 36B(c)(2)(B); Reg. 1.36B-2(c)(2): Medicare ends the credit for the
 *   person on it, not for the spouse (ACA-11, ACA-12).
 *
 * Under test: `checkAca` (`engine/post-withdrawal-optimizer.ts`), the
 * engine's cliff check, `getAcaSubsidyCliff`
 * (`src/lib/config/aca-tables.ts`) and `yearMagi`'s `aca` rule
 * (`src/lib/pure/tax/year-income.ts`), on the shipped 2026 poverty levels
 * (commit 3 checks sizes 1-8 against HHS). `checkAca` answers whether the
 * subsidy is kept and the MAGI headroom below the cliff; it has no credit
 * amount (v0.11 Retirement rules "Add: survivor benefit and first death",
 * the premium tax credit amount), so the credit figures sit in comments.
 * Its income parts are the engine's (Traditional draws, conversions,
 * brokerage gains, Roth growth, Social Security); a case's other ordinary
 * income (wages, municipal interest the engine has no input for) goes in
 * as the Traditional part, the same money in the sum.
 *
 * Not written here: the premium tax credit amount (the applicable
 * percentage, the credit, reconciliation): P21-P25, A3, A5-A17, A19, A20,
 * A23-A25, A27-A29, as todos at the end. A1 and A21 are counted as
 * expected failures but have no function to call yet (plan open question
 * 2), so they are todos too, their figures kept beside them.
 */
import { describe, it } from "vitest";
import { cents, runOneYear, xfail } from "../fixtures/answer-key";
import { checkAca } from "@/lib/calculators/engine/post-withdrawal-optimizer";
import { getAcaSubsidyCliff } from "@/lib/config/aca-tables";
import { yearMagi } from "@/lib/pure/tax/year-income";
import { engineHousehold } from "../fixtures/answer-key-household";
import { shippedTaxTables } from "../helpers/tax-data";

// ---------------------------------------------------------------------------
// Inputs: one coverage year (2026), the cliff check with awareness on
// ---------------------------------------------------------------------------

const FPL_2026 = () => shippedTaxTables(2026).fplByHousehold;

/** `checkAca` for a 2026 household whose income is all ordinary income
 *  (`ordinary`) plus an optional Roth conversion; 1 = kept, 0 = lost. */
function cliff(opts: {
  familySize: number;
  ordinary: number;
  conversion?: number;
  allPersonsUnder65?: boolean;
}): { preserved: number; headroom: number } {
  const r = checkAca({
    enableAcaAwareness: true,
    allPersonsUnder65: opts.allPersonsUnder65 ?? true,
    householdSize: opts.familySize,
    income: {
      traditionalDraws: opts.ordinary,
      rothTaxableGrowth: 0,
      rothConversions: opts.conversion ?? 0,
      realizedGains: 0,
      socialSecurity: { gross: 0 },
    },
    // 2026 coverage on 2026's own table: no growth.
    fplGrowthFactor: 1,
    fplByHousehold: FPL_2026(),
  });
  return {
    preserved: r.acaSubsidyPreserved ? 1 : 0,
    headroom: r.acaMagiHeadroom,
  };
}

/** Exactly 400% reads as over the cliff (verdict N4; IRC 36B(c)(1)(A):
 *  "not more than" 400%). */
const N4 =
  'v0.11 Retirement rules "January 1 birthday" (its "exactly 400% FPL"; verdict N4)';

/** One spouse 65 or older skips the check for the other (verdict N7). */
const N7 =
  'v0.11 Retirement rules "59½ tested by year" (verdict N7: one spouse on Medicare skips ACA for the other)';

// ---------------------------------------------------------------------------
// A. The cliff, in dollars
// ---------------------------------------------------------------------------

describe("answer key: the 400% cliff, 2026", () => {
  it("ret/A2 [RET-17] family of one, household income 62,601: over the cliff, no credit", () => {
    // 400% × 15,650 = 62,600. 62,601 is "more than" 400% (ACA-10), so no
    // credit and no headroom.
    cents(cliff({ familySize: 1, ordinary: 62_601 }), {
      preserved: 0,
      headroom: 0,
    });
  });

  describe("ret/A1:flag [RET-17]", () => {
    // A1's household (family of one, 2026, household income 62,600):
    // 400% × 15,650 = 62,600 is "not more than" 400% (ACA-10; Form 8962
    // instructions, "more than" 400% loses it), so the credit is kept;
    // headroom 62,600 − 62,600 = 0. A1's credit amount (5,765.04) waits on
    // the credit function (todo below); this is the flag alone. Today
    // `checkAca` keeps it only below the cliff (`<`): lost. Audit RT44 (the
    // `<=` fix) passes the decided flag and fails today's pin.
    xfail({
      id: "ret/A1:flag [RET-17]",
      todo: N4,
      run: () => cliff({ familySize: 1, ordinary: 62_600 }),
      expected: { preserved: 1, headroom: 0 },
      today: { preserved: 0, headroom: 0 },
    });
  });

  it("ret/A4 [RET-17] household income 60,000 plus a 3,000 conversion: 63,000, the credit is lost", () => {
    // Without the conversion: 60,000 ≤ 62,600, kept, 2,600 of headroom.
    cents(cliff({ familySize: 1, ordinary: 60_000 }), {
      preserved: 1,
      headroom: 2_600,
    });
    // The conversion is income (ACA-7): 63,000 > 62,600, lost. What it
    // costs is A3's credit, 6,024: 60,000 ÷ 15,650 = 383% (decimals
    // dropped, ACA-8), applicable percentage 9.96% (Rev. Proc. 2025-25
    // § 3.01, 300% to 400%), 60,000 × 9.96% = 5,976, and a 12,000
    // benchmark less 5,976. The amount needs the credit function (todo
    // A3 below).
    cents(cliff({ familySize: 1, ordinary: 60_000, conversion: 3_000 }), {
      preserved: 0,
      headroom: 0,
    });
  });

  it("ret/A30 [RET-17] retired July 2026, wages 40,000 and an IRA draw of 25,000: 65,000 for the year, no credit in any month", () => {
    // ACA-20: household income is the whole year's, the working months'
    // wages too: 40,000 + 25,000 = 65,000 > 62,600. No month of 2026
    // qualifies, the months after retiring included.
    cents(cliff({ familySize: 1, ordinary: 40_000 + 25_000 }), {
      preserved: 0,
      headroom: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// B. The poverty line, and the income it reads
// ---------------------------------------------------------------------------

describe("answer key: the poverty line and household income", () => {
  it("ret/A22 [RET-17] family of nine, 2026: poverty line 59,650, cliff 238,600", () => {
    // HHS25: 54,150 for eight + 5,500 for the ninth = 59,650; 400% =
    // 238,600.
    cents(getAcaSubsidyCliff(9, FPL_2026()), 238_600);
  });

  it("ret/A26 [RET-17] a couple, one 66 on Medicare: AGI 50,000, nontaxable Social Security 15,000, municipal interest 2,000: household income 67,000", () => {
    // Invented split: Social Security 30,000, of which 15,000 is taxable;
    // other income 35,000; AGI 35,000 + 15,000 = 50,000.
    // ACA (36B(d)(2)(B)): AGI + municipal interest + the nontaxable
    // Social Security = 50,000 + 2,000 + 15,000 = 67,000, i.e. other
    // income 35,000 + municipal 2,000 + all 30,000 of Social Security.
    // IRMAA's base for the same year is AGI + municipal interest = 52,000
    // (20 CFR 418.1010(b)(6); nontaxable Social Security isn't added: see
    // ret/I24). Ledgr's ACA sum takes the whole benefit; the municipal
    // interest has no input of its own and goes in with the other income.
    cents(
      yearMagi(
        {
          traditionalDraws: 35_000 + 2_000,
          rothConversions: 0,
          realizedGains: 0,
          rothTaxableGrowth: 0,
          socialSecurity: { gross: 30_000 },
        },
        "aca",
      ),
      67_000,
    );
  });
});

// ---------------------------------------------------------------------------
// C. One spouse on Medicare (verdict N7; audit RT48)
// ---------------------------------------------------------------------------

describe("answer key: one spouse on Medicare", () => {
  describe("ret/A32 [RET-17]", () => {
    // A couple 66 and 60, MAGI 50,000, family of two, 2026. Medicare ends
    // the credit for the 66-year-old only (ACA-11); the 60-year-old can
    // keep one, and household income still counts both (ACA-12). Cliff
    // 400% × 21,150 = 84,600; headroom 84,600 − 50,000 = 34,600. Today
    // `checkAca` skips the household once anyone is 65: not kept, 0.
    xfail({
      id: "ret/A32 [RET-17]",
      todo: N7,
      run: () =>
        cliff({ familySize: 2, ordinary: 50_000, allPersonsUnder65: false }),
      expected: { preserved: 1, headroom: 34_600 },
      today: { preserved: 0, headroom: 0 },
    });
  });

  describe("ret/A32:engine [RET-17]", () => {
    // The same couple through the engine (audit RT48: the engine's "everyone
    // under 65" test). Invented: A born 1960 (66 in 2026) draws Social
    // Security of 50,000 a year, claimed at 62; B born 1966 (60); MFJ,
    // spending 40,000, ACA awareness on, family of two, 0% COLA. Social
    // Security covers the spending, so nothing is drawn, and with
    // provisional income 25,000 (half the benefit) under 32,000 none of it
    // is taxable (IRC 86(b)(1), (c)(1)(B)): no tax, MAGI for the ACA = all 50,000 of
    // the benefit (ACA-7). Decided: kept, headroom 34,600. Today: not kept,
    // 0. RT48 (the household counted under 65 if anyone is) passes the
    // decided figure and fails today's pin.
    const run = () => {
      const h = engineHousehold({
        status: "MFJ",
        people: [
          { birthYear: 1960, socialSecurity: 50_000 },
          { birthYear: 1966 },
        ],
        traditionalIra: 500_000,
        spending: 40_000,
        endYear: 2027,
      });
      const year = runOneYear(
        {
          ...h,
          enableAcaAwareness: true,
          socialSecurityEntries: h.socialSecurityEntries!.map((e) =>
            e.personId === 1 ? { ...e, startAge: 62 } : e,
          ),
        },
        2026,
      );
      if (year.phase !== "decumulation") throw new Error("2026 isn't retired");
      return {
        ssIncome: year.ssIncome,
        drawn: year.totalWithdrawal,
        preserved: year.acaSubsidyPreserved ? 1 : 0,
        headroom: year.acaMagiHeadroom,
      };
    };
    xfail({
      id: "ret/A32:engine [RET-17]",
      todo: N7,
      run,
      expected: { ssIncome: 50_000, drawn: 0, preserved: 1, headroom: 34_600 },
      today: { ssIncome: 50_000, drawn: 0, preserved: 0, headroom: 0 },
    });
  });
});

// ---------------------------------------------------------------------------
// D. The credit amount: no function yet
// ---------------------------------------------------------------------------

describe("answer key: premium tax credit cases blocked on the credit amount", () => {
  const CREDIT =
    'v0.11 Retirement rules "Add: survivor benefit and first death" (premium tax credit amount)';
  // A1 (expected failure, N4): family of one, household income 62,600 =
  // exactly 400% of 15,650 (ACA-10: not "more than"), so the credit
  // stands: 9.96% × 62,600 = 6,234.96; 12,000 benchmark − 6,234.96 =
  // 5,765.04 (Rev. Proc. 2025-25 § 3.01; Reg. 1.36B-3(d)). Form 8962
  // rounds the contribution to whole dollars (ACA-18): 5,765. Today
  // `checkAca` reads exactly 400% as over (verdict N4, audit RT44): the
  // flag alone is `ret/A1:flag` above.
  it.todo(`ret/A1: blocked on ${CREDIT} (then N4, exactly 400%)`);
  // A21 (expected failure, N4): family of two, 84,600 = 400% of 21,150:
  // 9.96% × 84,600 = 8,426.16; 20,000 − 8,426.16 = 11,573.84.
  it.todo(`ret/A21: blocked on ${CREDIT} (then N4, exactly 400%)`);
  // P21-P25: Reg. 1.36B-3(g) Examples 1 and 2, 1.36B-3(d)(2) Examples 1
  // and 2, Pub 974 (Andrew). A3, A5-A17, A19, A20, A23-A25, A27-A29: the
  // spec's § 14.9 (percentages, the 133% step, 2027's table, Alaska, MFS
  // and QSS, the Medicare month, repayment caps).
  it.todo(`ret/P21: blocked on ${CREDIT}`);
  it.todo(`ret/P22: blocked on ${CREDIT}`);
  it.todo(`ret/P23: blocked on ${CREDIT}`);
  it.todo(`ret/P24: blocked on ${CREDIT}`);
  it.todo(`ret/P25: blocked on ${CREDIT}`);
  it.todo(`ret/A3: blocked on ${CREDIT}`);
  it.todo(`ret/A5: blocked on ${CREDIT}`);
  it.todo(`ret/A6: blocked on ${CREDIT}`);
  it.todo(`ret/A7: blocked on ${CREDIT}`);
  it.todo(`ret/A8: blocked on ${CREDIT}`);
  it.todo(`ret/A9: blocked on ${CREDIT}`);
  it.todo(`ret/A10: blocked on ${CREDIT}`);
  it.todo(`ret/A11: blocked on ${CREDIT}`);
  it.todo(`ret/A12: blocked on ${CREDIT}`);
  it.todo(`ret/A13: blocked on ${CREDIT}`);
  it.todo(`ret/A14: blocked on ${CREDIT}`);
  it.todo(`ret/A15: blocked on ${CREDIT}`);
  it.todo(`ret/A16: blocked on ${CREDIT}`);
  it.todo(`ret/A17: blocked on ${CREDIT}`);
  it.todo(`ret/A19: blocked on ${CREDIT}`);
  it.todo(`ret/A20: blocked on ${CREDIT}`);
  it.todo(`ret/A23: blocked on ${CREDIT}`);
  it.todo(`ret/A24: blocked on ${CREDIT}`);
  it.todo(`ret/A25: blocked on ${CREDIT}`);
  it.todo(`ret/A27: blocked on ${CREDIT}`);
  it.todo(`ret/A28: blocked on ${CREDIT}`);
  it.todo(`ret/A29: blocked on ${CREDIT}`);
});
