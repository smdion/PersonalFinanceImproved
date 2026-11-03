/**
 * Answer key: contribution limits (`.scratch/docs/drafts/answer-key.md`
 * § Limits; rulings in `reviews/2026-11-01/rebuild/limits-verdicts.md`,
 * working in `reviews/2026-11-01/specs/limits.md` § Worked cases).
 *
 * Every expected figure is worked by hand from the published rules, never
 * read from `src/`: IRS Notice 2024-80 (2025 limits) and Notice 2025-67
 * (2026), Rev. Proc. 2024-25 / 2025-19 (HSA), IRC 402(g), 414(v), 415(c),
 * 219, 408A, 223, Pub 590-A (2025), Pub 969 (2025). The functions are fed
 * the shipped tax data (`tax-data/us-federal/`, as installs read it), so a
 * wrong shipped figure fails here too; `tests/config/irs-contribution-
 * limits.test.ts` checks each figure against the notices on its own.
 *
 * Ages are the age reached by Dec 31 of the tax year (IRC 414(v)(5)(A);
 * the cap pass takes the birth year and works it out, LIM-05).
 *
 * Not written here (one header for the bulk group, as the key lists it):
 * blocked on inputs Ledgr has no field for, all under v0.11 Limits
 * "Answer key, limits bulk group" (`plans/todo/v0.11.x.md` § Limits), by
 * cause:
 * - C19 (457(b)/SIMPLE/SEP type), C21, C22 (403(b) 15-year catch-up),
 *   C46 (plan-allows-after-tax flag): disclosed (v0.12 list, decided
 *   2026-11-02).
 * - C23–C34: prior-year W-2 box 3 wages per employer and "plan offers
 *   Roth" → v0.11 Limits "Mandatory Roth catch-up (SECURE 2.0 § 603) not
 *   modelled".
 * - C48: after-tax money already put into the 401(k) this year → built in
 *   v0.11 (decided 2026-11-02; R42).
 * - C131–C133, C138, C142, C143: HSA coverage by month and Medicare start
 *   → HSA part-year coverage in v0.11 Tax "Absent rules", with the HSA
 *   Medicare check (Advice).
 * - C135–C137: HSA testing-period failure: disclosed (v0.12 list).
 * - C144: HSA dependent flag: disclosed (v0.12 list).
 * - C59: MFS, lived together: closed (MFS unsupported, decision B2).
 * - C90–C114: covered-by-a-workplace-plan flags and deduction MAGI
 *   (R61–R65) → a per-person "covered" flag with the IRA deduction
 *   phase-out keys (v0.11 Limits "Tax data lacks keys").
 * - C115–C117: pro-rata fraction (R67) → v0.11 Retirement rules "No IRA
 *   basis input".
 *
 * Ledgr has no QSS or MFS filing status, so C79–C84 and C89 test the
 * phase-out range function only, with the range (or a net MAGI) fed in.
 */
import { describe, expect, it } from "vitest";
import {
  capContributionsByLimitGroup,
  type CapPerson,
  type CapRow,
} from "@/lib/pure/contribution-caps";
import { resolveIrsLimit } from "@/lib/pure/contributions";
import { judgeRothIra, rothIraAllowed } from "@/lib/pure/roth-ira";
import { megaBackdoorRoom } from "@/lib/pure/milestone-input";
import { computeEmployerMatch } from "@/server/helpers/contribution-match";
import { taxDataLimitMap } from "../helpers/tax-data";
import { cents, xfail } from "../fixtures/answer-key";

// ---------------------------------------------------------------------------
// Inputs: the shipped limits for a year, and invented households
// ---------------------------------------------------------------------------

const shipped = taxDataLimitMap();

/** The shipped `contribution_limits` for one tax year, keyed by limit type. */
function limitsFor(year: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of shipped) {
    const [y, type] = key.split(":");
    if (Number(y) === year) out[type!] = value;
  }
  if (Object.keys(out).length === 0)
    throw new Error(`no shipped limits for ${year}`);
  return out;
}

let nextId = 1;
/** One contribution row; money is yearly. */
function row(
  over: Partial<CapRow> & Pick<CapRow, "personId" | "accountType">,
): CapRow {
  return {
    id: nextId++,
    hsaCoverageType: null,
    regularAnnual: 0,
    bonusAnnual: 0,
    employerAnnual: 0,
    reducesCompensation: false,
    ...over,
  };
}

/** A person `age` at Dec 31 of `year`, with W-2 pay `wages`. */
const person = (
  id: number,
  year: number,
  age: number,
  wages: number | null = 200_000,
): CapPerson => ({ id, birthYear: year - age, wages });

/** The cap pass for one year's shipped limits. */
function cap(
  year: number,
  people: CapPerson[],
  rows: CapRow[],
  filingStatus = "Single",
) {
  return capContributionsByLimitGroup(rows, {
    taxYear: year,
    filingStatus,
    limits: limitsFor(year),
    people,
  }).byRow;
}

/** One 401(k) row far over any limit, capped: the person's 402(g) limit
 *  plus the catch-up their Dec 31 age allows. */
function deferralLimit(year: number, birthYear: number, wages = 200_000) {
  const r = row({ personId: 1, accountType: "401k", regularAnnual: 100_000 });
  return cap(year, [{ id: 1, birthYear, wages }], [r]).get(r.id)!.cappedAnnual;
}

// The figures the working below uses, from the notices:
//   402(g)(1) deferral limit      2025 23,500  2026 24,500  (N2024-80 p.1 / N2025-67 p.1)
//   414(v)(2)(B)(i) catch-up      2025  7,500  2026  8,000  (same, p.1)
//   414(v)(2)(E)(i) 60–63         2025 11,250  2026 11,250  (same, pp.1–2)
//   415(c)(1)(A) annual additions 2025 70,000  2026 72,000  (same, p.1)
//   401(a)(17) compensation cap   2025 350,000 2026 360,000 (same, p.2)
//   HSA self-only / family        2025 4,300 / 8,550; 2026 4,400 / 8,750
//                                 (Rev. Proc. 2024-25 / 2025-19 § 2.01(1))
//   HSA catch-up, 223(b)(3)(B)    1,000 (statutory, not indexed)
//   IRA limit, 219(b)(5)(A)       2025  7,000  2026  7,500  (N2024-80 / N2025-67 p.4)
//   IRA catch-up, 219(b)(5)(B)    2025  1,000  2026  1,100  (same, p.4)
//   Roth phase-out start, Single and HOH 2025 150,000  2026 153,000;
//     MFJ (and QSS) 2025 236,000  2026 242,000; MFS 0 (same, pp.4–5).
//     Widths are statutory: 15,000 Single/HOH, 10,000 MFJ/QSS/MFS
//     (408A(c)(3)(A)).

// ---------------------------------------------------------------------------
// A. Deferrals and age (IRC 402(g)(1), 414(v)(2)(B), (v)(2)(E), (v)(5))
// ---------------------------------------------------------------------------

describe("limits: deferrals and age", () => {
  it("limits/C1 [LIM-03] no catch-up at 49 (2026, born 1977-06-15, pay 200,000): 24,500", () => {
    // 2026 − 1977 = 49 at Dec 31: under 50, no catch-up. 402(g) alone.
    cents(deferralLimit(2026, 1977), 24_500);
  });

  it("limits/C2 [LIM-05] 50 on Jan 1 next year (2026, born 1977-01-01): 24,500", () => {
    // The 50th birthday is 2027-01-01, after the year ends: 49 at Dec 31
    // 2026 (414(v)(5)(A) "would attain age 50 by the end of the taxable
    // year"). 24,500, no catch-up.
    cents(deferralLimit(2026, 1977), 24_500);
  });

  it("limits/C3 [LIM-05] 50 on Dec 31 (2026, born 1976-12-31): 32,500", () => {
    // Attains 50 on the year's last day, so within the year (414(v)(5)(A);
    // Reg. 1.414(v)-1(g)(3)(ii)). 24,500 + 8,000 = 32,500.
    cents(deferralLimit(2026, 1976), 32_500);
  });

  it("limits/C4 [LIM-03] 59 (2026, born 1967-03-03): 32,500", () => {
    // 59 at Dec 31: regular catch-up. 24,500 + 8,000 = 32,500.
    cents(deferralLimit(2026, 1967), 32_500);
  });

  it("limits/C5 [LIM-04] 60 on Dec 31 (2026, born 1966-12-31): 35,750", () => {
    // Attains 60 in 2026: the 60–63 amount replaces the regular one
    // (414(v)(2)(E)). 24,500 + 11,250 = 35,750.
    cents(deferralLimit(2026, 1966), 35_750);
  });

  it("limits/C6 [LIM-04] 63 (2026, born 1963-01-01): 35,750", () => {
    // Attains 63, not 64, in 2026. 24,500 + 11,250 = 35,750.
    cents(deferralLimit(2026, 1963), 35_750);
  });

  it("limits/C7 [LIM-04] 64 on Dec 31 (2026, born 1962-12-31): 32,500", () => {
    // Attains 64 in 2026, even on the last day: out of 60–63 for the whole
    // year (414(v)(2)(E) "would not attain age 64"). 24,500 + 8,000.
    cents(deferralLimit(2026, 1962), 32_500);
  });

  it("limits/C8 [LIM-03] 2025, 49 (born 1976): 23,500", () => {
    // 2025 − 1976 = 49. 402(g) 2025 alone: 23,500.
    cents(deferralLimit(2025, 1976), 23_500);
  });

  it("limits/C9 [LIM-03] 2025, 50 (born 1975): 31,000", () => {
    // 23,500 + 7,500 = 31,000.
    cents(deferralLimit(2025, 1975), 31_000);
  });

  it("limits/C10 [LIM-03] 2025, 59 (born 1966): 31,000", () => {
    // 23,500 + 7,500 = 31,000.
    cents(deferralLimit(2025, 1966), 31_000);
  });

  it("limits/C11 [LIM-04] 2025, 60 (born 1965): 34,750", () => {
    // 60–63 amount, first year it applies (SECURE 2.0 § 109).
    // 23,500 + 11,250 = 34,750.
    cents(deferralLimit(2025, 1965), 34_750);
  });

  it("limits/C12 [LIM-04] 2025, 63 (born 1962): 34,750", () => {
    // 23,500 + 11,250 = 34,750.
    cents(deferralLimit(2025, 1962), 34_750);
  });

  it("limits/C13 [LIM-04] 2025, 64 (born 1961): 31,000", () => {
    // 64: back to the regular catch-up. 23,500 + 7,500 = 31,000.
    cents(deferralLimit(2025, 1961), 31_000);
  });

  // C14: deferrals can't pass pay. 2026, born 1971 (55), pay 10,000, a
  // plan that allows all of pay, 24,500 asked. Total deferrals never pass
  // compensation: 415(c)(1)(B) "100 percent of the participant's
  // compensation", and for the catch-up leg 414(v)(2)(A)(ii) (compensation
  // less other deferrals). min(32,500, 10,000) = 10,000. Today the cap
  // pass keeps 24,500 (the router repro's net check is −587.11).
  xfail({
    id: "limits/C14 [LIM-06]",
    todo: 'v0.11 Limits "Annual-additions step per employer" (verdict D1)',
    run: () => {
      const r = row({
        personId: 1,
        accountType: "401k",
        regularAnnual: 24_500,
      });
      return cap(2026, [person(1, 2026, 55, 10_000)], [r]).get(r.id)!
        .cappedAnnual;
    },
    expected: 10_000,
    today: 24_500,
  });
});

// ---------------------------------------------------------------------------
// B. Several employers (402(g)(1) per person; R9, R10)
// ---------------------------------------------------------------------------

/**
 * Room left at employer B after employer A's deferrals: the person's most
 * in the shared 402(g) group (`maxEmployee`) less A's money. B's own row is
 * there with nothing in it yet.
 */
function roomAtB(age: number, atA: number): number {
  const a = row({ personId: 1, accountType: "401k", regularAnnual: atA });
  const b = row({ personId: 1, accountType: "401k", regularAnnual: 0 });
  const capped = cap(2026, [person(1, 2026, age, 300_000)], [a, b]);
  expect(capped.get(a.id)!.cappedAnnual, "A's money isn't cut").toBe(atA);
  return capped.get(b.id)!.maxEmployee! - capped.get(a.id)!.cappedAnnual;
}

describe("limits: several employers", () => {
  it("limits/C15 [LIM-06] per person across employers (2026, 45, 15,000 at A): room at B 9,500", () => {
    // One 402(g) limit per person across every plan (402(g)(1)(A);
    // Notice 2023-62 § III.B). 24,500 − 15,000 = 9,500.
    cents(roomAtB(45, 15_000), 9_500);
  });

  it("limits/C16 [LIM-06] catch-up at either plan (2026, 62, 24,500 at A): room at B 11,250", () => {
    // 60–63: 35,750 − 24,500 = 11,250, which can sit at B.
    cents(roomAtB(62, 24_500), 11_250);
  });

  it("limits/C17 [LIM-06] job change (2026, 55, 30,000 at A): room at B 2,500", () => {
    // 32,500 − 30,000 = 2,500 (earlier employer's deferrals count, R10).
    cents(roomAtB(55, 30_000), 2_500);
  });

  it("limits/C18 [LIM-06] job change, full (2026, 45, 24,500 at A): room at B 0", () => {
    // 24,500 − 24,500 = 0.
    cents(roomAtB(45, 24_500), 0);
  });

  // C20: each plan is bound by its own employer's pay. 2026, 52, two
  // jobs paying 10,000 each, 32,500 asked at each. 415(c)(1)(B) per
  // employer: 10,000 + 10,000 = 20,000, under the 32,500 personal cap.
  // Ledgr has wages per person, so it pools them (20,000) and holds the
  // two rows to the 402(g) cap only: 32,500 (derived; the key gives no
  // Today figure).
  xfail({
    id: "limits/C20 [LIM-06]",
    todo: 'v0.11 Limits "Annual-additions step per employer" (verdict D1b)',
    run: () => {
      const a = row({
        personId: 1,
        accountType: "401k",
        regularAnnual: 32_500,
      });
      const b = row({
        personId: 1,
        accountType: "401k",
        regularAnnual: 32_500,
      });
      const capped = cap(2026, [person(1, 2026, 52, 20_000)], [a, b]);
      return capped.get(a.id)!.cappedAnnual + capped.get(b.id)!.cappedAnnual;
    },
    expected: 20_000,
    today: 32_500,
  });
});

// ---------------------------------------------------------------------------
// D. Total additions and mega backdoor room (IRC 415(c); R33–R44)
// ---------------------------------------------------------------------------

/** After-tax room in one plan (`megaBackdoorRoom`): min(415(c), pay) less
 *  deferrals up to the base limit and employer money. */
function megaRoom(
  year: number,
  pay: number,
  deferrals: number,
  employer: number,
) {
  const [r] = megaBackdoorRoom(
    [
      {
        name: "P",
        compensation: pay,
        accountTypes: [
          {
            categoryKey: "401k",
            employeeContrib: deferrals,
            employerMatch: employer,
          },
        ],
      },
    ],
    limitsFor(year),
  );
  return r!;
}

/** Whole-plan maximum: the capped deferrals (402(g) + catch-up) plus the
 *  after-tax room left beside them, on pay above every limit. */
function wholePlanMax(age: number): number {
  const deferrals = deferralLimit(2026, 2026 - age, 1_000_000);
  return deferrals + megaRoom(2026, 1_000_000, deferrals, 0).room;
}

describe("limits: total additions and mega backdoor room", () => {
  it("limits/C35 [LIM-17] mega room (2026, 45, pay 300,000, deferrals 24,500, employer 15,000): 32,500", () => {
    // 415(c)(1)(A) 72,000 − (24,500 + 15,000) = 32,500.
    cents(megaRoom(2026, 300_000, 24_500, 15_000).room, 32_500);
  });

  it("limits/C36 [LIM-17] catch-up outside 415(c) (2026, 52, deferrals 32,500): 32,500", () => {
    // The 8,000 catch-up isn't an annual addition (414(v)(3)(A); Reg.
    // 1.414(v)-1(d)(1)): 72,000 − (24,500 + 15,000) = 32,500.
    cents(megaRoom(2026, 300_000, 32_500, 15_000).room, 32_500);
  });

  it("limits/C37 [LIM-16] whole-plan maximum at 50+ (2026, 52): 80,000", () => {
    // 415(c) 72,000 plus the 8,000 catch-up outside it = 80,000 (R35; IRS
    // 401(k) limits page). Deferrals 32,500 + room 72,000 − 24,500.
    cents(wholePlanMax(52), 80_000);
  });

  it("limits/C38 [LIM-16] whole-plan maximum at 60–63 (2026, 62): 83,250", () => {
    // 72,000 + 11,250 = 83,250. Deferrals 35,750 + room 47,500.
    cents(wholePlanMax(62), 83_250);
  });

  it("limits/C39 [LIM-17] pay bound (2026, 45, pay 50,000, deferrals 24,500, employer 5,000): 20,500", () => {
    // 415(c)(1): min(72,000, 50,000) − (24,500 + 5,000) = 20,500.
    cents(megaRoom(2026, 50_000, 24_500, 5_000).room, 20_500);
  });

  // C40: 415(c) excess. 2026, 45, pay 20,000, deferrals 20,000, employer
  // 5,000. Annual additions 25,000 against min(72,000, 20,000) = 20,000:
  // 5,000 over (415(c)(1)(B)). The cap pass has no 415(c) step, so
  // nothing is over today (verdict D2: 0).
  xfail({
    id: "limits/C40 [LIM-06]",
    todo: 'v0.11 Limits "Annual-additions step per employer" (verdict D2)',
    run: () => {
      const r = row({
        personId: 1,
        accountType: "401k",
        regularAnnual: 20_000,
        employerAnnual: 5_000,
      });
      return cap(2026, [person(1, 2026, 45, 20_000)], [r]).get(r.id)!.overBy;
    },
    expected: 5_000,
    today: 0,
  });

  it("limits/C41 [LIM-06] over 415(c) as catch-up (2026, 52, pay 20,000, deferrals 20,000, employer 5,000): excess 0", () => {
    // At 52, the 5,000 of deferrals past 415(c) are catch-up (Reg.
    // 1.414(v)-1(b)(1)(i), 415(c) is an applicable limit): additions
    // 20,000 ≤ 20,000, and catch-up 5,000 ≤ 414(v)(2)(A)(ii)'s
    // 20,000 − 15,000. Nothing over. Ledgr agrees only because it has no
    // 415(c) step (D1); kept as the guard on the catch-up side of the fix.
    const r = row({
      personId: 1,
      accountType: "401k",
      regularAnnual: 20_000,
      employerAnnual: 5_000,
    });
    cents(cap(2026, [person(1, 2026, 52, 20_000)], [r]).get(r.id)!.overBy, 0);
  });

  it("limits/C42 [LIM-17] 415(c) per unrelated employer (2026, 46, solo plan beside a W-2 plan): 72,000", () => {
    // 415(c) is per employer (415(f)(1)(B); R38): the W-2 plan's 24,500 of
    // deferrals don't touch the solo plan's limit, so the solo plan alone
    // (business pay above the limit, nothing in it yet) has 72,000.
    cents(megaRoom(2026, 900_000, 0, 0).room, 72_000);
  });

  it("limits/C43 [LIM-17] related employers share 415(c) (2026, 45, 24,500 at A, employer 20,000 at B): 27,500", () => {
    // One limit across related employers (415(h); R38):
    // 72,000 − (24,500 + 20,000) = 27,500.
    cents(megaRoom(2026, 300_000, 24_500, 20_000).room, 27_500);
  });

  // C44: match on capped pay (401(a)(17)). 2026, pay 400,000, a 100% match
  // up to 6% of pay, deferrals 24,500, after-tax allowed. Pay for the
  // match is min(400,000, 360,000): 6% × 360,000 = 21,600 (24,500 is more
  // than 6%, so the cap binds). Room 72,000 − (24,500 + 21,600) = 25,900.
  // Today the match is on all of pay: 6% × 400,000 = 24,000, room
  // 72,000 − 48,500 = 23,500 (limits-report D7).
  const matchAndRoom = (
    year: number,
    pay: number,
    pct: number,
    emp: number,
  ) => {
    const match = computeEmployerMatch(
      "percent_of_contribution",
      100,
      pct / 100,
      emp,
      "fixed_annual",
      0,
      pay,
    );
    return { match, room: megaRoom(year, pay, emp, match).room };
  };
  xfail({
    id: "limits/C44 [LIM-18]",
    todo: 'v0.11 Limits "Match on min(pay, compCap)" (verdict D7)',
    run: () => matchAndRoom(2026, 400_000, 6, 24_500),
    expected: { match: 21_600, room: 25_900 },
    today: { match: 24_000, room: 23_500 },
  });

  // C45: the same in 2025. 401(a)(17) 350,000; 100% match up to 4%:
  // 4% × 350,000 = 14,000. Room 70,000 − (23,500 + 14,000) = 32,500.
  // Today: 4% × 400,000 = 16,000, room 70,000 − 39,500 = 30,500 (derived;
  // the key gives no Today figure).
  xfail({
    id: "limits/C45 [LIM-18]",
    todo: 'v0.11 Limits "Match on min(pay, compCap)" (verdict D7)',
    run: () => matchAndRoom(2025, 400_000, 4, 23_500),
    expected: { match: 14_000, room: 32_500 },
    today: { match: 16_000, room: 30_500 },
  });

  it("limits/C47 [LIM-17] room floors at 0 (2026, employer 50,000, deferrals 24,500): 0", () => {
    // 72,000 − 74,500 < 0: no room, never negative.
    cents(megaRoom(2026, 300_000, 24_500, 50_000).room, 0);
  });
});

// ---------------------------------------------------------------------------
// E. IRA limit (IRC 219(b), (c); Pub 590-A (2025) ch. 1)
// ---------------------------------------------------------------------------

/** One person's IRA row far over any limit, capped (single filer): the
 *  IRA limit with catch-up, bounded by taxable pay. */
function iraLimit(year: number, age: number, pay: number): number {
  const r = row({ personId: 1, accountType: "ira", regularAnnual: 20_000 });
  return cap(year, [person(1, year, age, pay)], [r]).get(r.id)!.cappedAnnual;
}

/**
 * Joint return: the higher earner (person 1) puts `higherIra` in; the most
 * the lower earner (person 2, nothing in yet) can put in. 219(c): the
 * lower earner's limit is min(limit, own pay + spouse's pay − spouse's
 * IRA money).
 */
function spousalRoom(
  year: number,
  ages: [number, number],
  pays: [number, number],
  higherIra: number,
): number {
  const a = row({ personId: 1, accountType: "ira", regularAnnual: higherIra });
  const b = row({ personId: 2, accountType: "ira", regularAnnual: 0 });
  const capped = cap(
    year,
    [person(1, year, ages[0], pays[0]), person(2, year, ages[1], pays[1])],
    [a, b],
    "MFJ",
  );
  expect(capped.get(a.id)!.cappedAnnual, "the higher earner isn't cut").toBe(
    higherIra,
  );
  return capped.get(b.id)!.maxEmployee!;
}

/** Joint return, both spouses' IRA rows capped. */
function coupleIra(
  pays: [number, number],
  iras: [number, number],
  ages: [number, number] = [45, 45],
) {
  const a = row({ personId: 1, accountType: "ira", regularAnnual: iras[0] });
  const b = row({ personId: 2, accountType: "ira", regularAnnual: iras[1] });
  const capped = cap(
    2026,
    [person(1, 2026, ages[0], pays[0]), person(2, 2026, ages[1], pays[1])],
    [a, b],
    "MFJ",
  );
  return {
    higher: capped.get(a.id)!.cappedAnnual,
    lower: capped.get(b.id)!.cappedAnnual,
  };
}

/** The Roth IRA "Allowed" figure (`maxDirect`) for one person with
 *  `traditional` already in a traditional IRA. */
const allowedDirect = (
  status: "Single" | "MFJ",
  age: number,
  magi: number,
  traditional: number,
) => {
  const r = row({
    personId: 1,
    accountType: "ira",
    regularAnnual: traditional,
  });
  const capped = cap(2026, [person(1, 2026, age, 300_000)], [r], status).get(
    r.id,
  )!;
  const judged = judgeRothIra({
    magi,
    phaseOut: rothRange(2026, status === "MFJ" ? "mfj" : "single"),
    marginOverride: null,
    combinedCompensation: status === "MFJ",
    people: [
      {
        personId: 1,
        name: "P",
        compensation: 300_000,
        iraLimit: capped.limit!,
        iraRoom: capped.maxEmployee,
      },
    ],
  });
  return judged!.people[0]!.maxDirect;
};

describe("limits: IRA", () => {
  it("limits/C49 [LIM-11] IRA (2026, 49, pay 100,000): 7,500", () => {
    // 219(b)(5)(A), Notice 2025-67 p.4: 7,500. Under 50, no catch-up.
    cents(iraLimit(2026, 49, 100_000), 7_500);
  });

  it("limits/C50 [LIM-11] IRA catch-up (2026, 50): 8,600", () => {
    // 7,500 + 1,100 (219(b)(5)(B); Notice 2025-67 p.4) = 8,600.
    cents(iraLimit(2026, 50, 100_000), 8_600);
  });

  it("limits/C51 [LIM-11] 2025 IRA (49): 7,000", () => {
    // Notice 2024-80 p.4: 7,000.
    cents(iraLimit(2025, 49, 100_000), 7_000);
  });

  it("limits/C52 [LIM-11] 2025 catch-up (50): 8,000", () => {
    // 7,000 + 1,000 = 8,000.
    cents(iraLimit(2025, 50, 100_000), 8_000);
  });

  it("limits/C53 [LIM-11] no upper age (2026, 80, pay 40,000): 8,600", () => {
    // The age-70½ cut-off is gone for years after 2019 (Pub 590-A (2025)
    // ch. 1): 7,500 + 1,100 = 8,600, pay 40,000 doesn't bind.
    cents(iraLimit(2026, 80, 40_000), 8_600);
  });

  it('limits/C54 [LIM-11] pay binds (Pub 590-A "Danny"; 2025, unmarried, pay 3,500): 3,500', () => {
    // 219(b)(1): the lesser of 7,000 and taxable compensation, 3,500 (Pub
    // 590-A (2025) ch. 1, the Danny example; a student, under 50).
    cents(iraLimit(2025, 20, 3_500), 3_500);
  });

  // C55: Roth room after a traditional IRA. 2026, 50, 5,000 traditional,
  // MAGI under the range. One limit across both kinds (408A(c)(2); Pub
  // 590-A Worksheet 2-2 lines 9–11): 8,600 − 5,000 = 3,600. Today the
  // "Allowed" figure stops at line 8 and shows the whole 8,600 (verdict
  // D5). Fed as the Paycheck router does (`routers/paycheck.ts:904`): the
  // cap pass's room goes in as `iraRoom`.
  xfail({
    id: "limits/C55 [LIM-13]",
    todo: "v0.11 Limits \"Roth 'Allowed today' stops at worksheet line 8\" (verdict D5)",
    run: () => allowedDirect("Single", 50, 50_000, 5_000),
    expected: 3_600,
    today: 8_600,
  });

  it("limits/C56 [LIM-11] spousal IRA (Pub 590-A; 2025 MFJ, A pay 30,000 gives 7,000, B no pay): 7,000", () => {
    // 219(c): min(7,000, 0 + 30,000 − 7,000) = 7,000.
    cents(spousalRoom(2025, [45, 45], [30_000, 0], 7_000), 7_000);
  });

  it("limits/C57 [LIM-11] spousal, low pay (2026 MFJ, A pay 10,000 gives 7,500, B none): 2,500", () => {
    // 219(c): min(7,500, 0 + 10,000 − 7,500) = 2,500.
    cents(spousalRoom(2026, [45, 45], [10_000, 0], 7_500), 2_500);
  });

  it("limits/C58 [LIM-11] lower earner (Pub 590-A; 2025 MFJ, both 53, pay 3,800 and 48,000): 8,000", () => {
    // The higher earner puts in 8,000; the lower earner:
    // min(7,000 + 1,000, 3,800 + 48,000 − 8,000) = 8,000.
    cents(spousalRoom(2025, [53, 53], [48_000, 3_800], 8_000), 8_000);
  });

  it("limits/C60 [LIM-11] combined maximum (2026 MFJ, 55 and 45, pay above the limits): 16,100", () => {
    // Each spouse's own limit (Pub 590-A p.10): 8,600 + 7,500 = 16,100.
    const both = coupleIra([300_000, 300_000], [20_000, 20_000], [55, 45]);
    cents(both.higher + both.lower, 16_100);
  });

  // D4: the higher earner is held to their own pay (219(c)(2)(B): only
  // the spouse with less compensation uses the couple's). Ledgr pools both
  // spouses' pay for both (limits-report D4: today's figures below).
  //
  // D4-a: pay 5,000 / 3,000, IRA 7,500 / 500. Higher earner:
  // min(7,500, 5,000) = 5,000. Lower: min(7,500, 3,000 + 5,000 − 5,000)
  // = 3,000 ≥ 500, so 500. Today: 8,000 pooled pay holds 7,500 + 500.
  xfail({
    id: "limits/D4-a [LIM-11]",
    todo: 'v0.11 Limits "Higher earner held to own pay, not joint" (verdict D4)',
    run: () => coupleIra([5_000, 3_000], [7_500, 500]),
    expected: { higher: 5_000, lower: 500 },
    today: { higher: 7_500, lower: 500 },
  });
  // D4-b: pay 5,000 / 1,000, IRA 7,500 / 1,000. Higher: 5,000. Lower:
  // min(7,500, 1,000 + 5,000 − 5,000) = 1,000. Today: 8,500 cut to the
  // pooled 6,000 by one factor 6,000 / 8,500: 7,500 × 0.70588… = 5,294.12,
  // 1,000 × 0.70588… = 705.88.
  xfail({
    id: "limits/D4-b [LIM-11]",
    todo: 'v0.11 Limits "Higher earner held to own pay, not joint" (verdict D4)',
    run: () => coupleIra([5_000, 1_000], [7_500, 1_000]),
    expected: { higher: 5_000, lower: 1_000 },
    today: { higher: 5_294.12, lower: 705.88 },
  });
});

// ---------------------------------------------------------------------------
// F. Roth IRA phase-out (IRC 408A(c)(3); Pub 590-A (2025) Worksheet 2-2)
// ---------------------------------------------------------------------------

/** The shipped Roth IRA phase-out range for a status's table. */
function rothRange(year: number, table: "single" | "mfj" | "hoh") {
  const limits = limitsFor(year);
  return {
    start: limits[`roth_ira_phaseout_start_${table}`]!,
    end: limits[`roth_ira_phaseout_end_${table}`]!,
  };
}

/** MFS, lived with the spouse at any time in the year: 0 to 10,000
 *  (408A(c)(3)(A); Notice 2025-67 p.5). Hand-keyed: Ledgr has no MFS. */
const MFS_LIVED_TOGETHER = { start: 0, end: 10_000 };

/** The IRA base the worksheet reduces (line 4 against compensation): the
 *  cap pass's most for one person, nothing in yet. */
function iraBase(year: number, age: number, pay = 300_000): number {
  const r = row({ personId: 1, accountType: "ira", regularAnnual: 0 });
  return cap(year, [person(1, year, age, pay)], [r]).get(r.id)!.maxEmployee!;
}

/** Worksheet 2-2 on the shipped range: the reduced Roth IRA limit. */
const roth = (
  year: number,
  table: "single" | "mfj" | "hoh",
  age: number,
  magi: number,
) => rothIraAllowed(magi, rothRange(year, table), iraBase(year, age));

// Working, Worksheet 2-2 (Pub 590-A 2025): reduction = base × (MAGI −
// start) / width; base − reduction rounded UP to the next $10 (line 8);
// any result above 0 and under 200 is 200; at or past the end, 0.
describe("limits: Roth IRA phase-out", () => {
  it("limits/C61 [LIM-12] phase-out start (2026 Single, 45, MAGI 153,000): 7,500", () => {
    // At the start: no reduction.
    cents(roth(2026, "single", 45, 153_000), 7_500);
  });

  it("limits/C62 [LIM-12] $0.50 rounds to 0 (MAGI 153,001): 7,500", () => {
    // 7,500 × 1 / 15,000 = 0.50; 7,499.50 rounds up to 7,500.
    cents(roth(2026, "single", 45, 153_001), 7_500);
  });

  it("limits/C63 [LIM-12] $9.50 rounds to 0 (MAGI 153,019): 7,500", () => {
    // 7,500 × 19 / 15,000 = 9.50; 7,490.50 rounds up to 7,500.
    cents(roth(2026, "single", 45, 153_019), 7_500);
  });

  it("limits/C64 [LIM-12] $10 (MAGI 153,020): 7,490", () => {
    // 7,500 × 20 / 15,000 = 10; 7,490 exactly.
    cents(roth(2026, "single", 45, 153_020), 7_490);
  });

  it("limits/C65 [LIM-12] half (MAGI 160,500): 3,750", () => {
    // 7,500 × 7,500 / 15,000 = 3,750; 3,750.
    cents(roth(2026, "single", 45, 160_500), 3_750);
  });

  it("limits/C66 [LIM-12] half at 55 (MAGI 160,500): 4,300", () => {
    // Base 8,600; × 0.5 = 4,300 off; 4,300.
    cents(roth(2026, "single", 55, 160_500), 4_300);
  });

  it("limits/C67 [LIM-12] near the end (45, MAGI 167,500): 250", () => {
    // 7,500 × 14,500 / 15,000 = 7,250; 250.
    cents(roth(2026, "single", 45, 167_500), 250);
  });

  it("limits/C68 [LIM-12] MAGI 167,600: 200", () => {
    // 7,500 × 14,600 / 15,000 = 7,300; 200.
    cents(roth(2026, "single", 45, 167_600), 200);
  });

  it("limits/C69 [LIM-12] MAGI 167,601: 200", () => {
    // 7,300.50 off; 199.50 rounds up to 200.
    cents(roth(2026, "single", 45, 167_601), 200);
  });

  it("limits/C70 [LIM-12] $200 floor (MAGI 167,620): 200", () => {
    // 7,310 off; 190, under 200, becomes 200 (219(g)(2)(B)).
    cents(roth(2026, "single", 45, 167_620), 200);
  });

  it("limits/C71 [LIM-12] floor (MAGI 167,999): 200", () => {
    // 7,499.50 off; 0.50 rounds up to 10, floored to 200.
    cents(roth(2026, "single", 45, 167_999), 200);
  });

  it("limits/C72 [LIM-12] out (MAGI 168,000): 0", () => {
    // At the end of the range: fully phased out.
    cents(roth(2026, "single", 45, 168_000), 0);
  });

  it("limits/C73 [LIM-12] HOH uses the Single range (2026 HOH, 45, MAGI 160,000): 4,000", () => {
    // 153,000–168,000 (Notice 2025-67 p.5): 7,500 × 7,000 / 15,000 =
    // 3,500 off; 4,000.
    cents(roth(2026, "hoh", 45, 160_000), 4_000);
  });

  it("limits/C74 [LIM-12] MFJ start (2026 MFJ, 45, MAGI 242,000): 7,500", () => {
    // At the start of 242,000–252,000.
    cents(roth(2026, "mfj", 45, 242_000), 7_500);
  });

  it("limits/C75 [LIM-12] MFJ half (MAGI 247,000): 3,750", () => {
    // 7,500 × 5,000 / 10,000 = 3,750 off; 3,750.
    cents(roth(2026, "mfj", 45, 247_000), 3_750);
  });

  it("limits/C76 [LIM-12] MFJ at 50 (MAGI 245,000): 6,020", () => {
    // 8,600 × 3,000 / 10,000 = 2,580 off; 6,020.
    cents(roth(2026, "mfj", 50, 245_000), 6_020);
  });

  it("limits/C77 [LIM-12] MFJ floor (45, MAGI 251,999): 200", () => {
    // 7,500 × 9,999 / 10,000 = 7,499.25 off; 0.75 → 10 → floored to 200.
    cents(roth(2026, "mfj", 45, 251_999), 200);
  });

  it("limits/C78 [LIM-12] MFJ out (MAGI 252,000): 0", () => {
    cents(roth(2026, "mfj", 45, 252_000), 0);
  });

  it("limits/C79 [LIM-12] QSS uses the MFJ table, range function only (2026, 45, MAGI 247,000): 3,750", () => {
    // 408A(c)(3)(B)(ii) and Notice 2025-67 p.5 put QSS on the MFJ range;
    // Ledgr has no QSS status, so the MFJ range is fed in. As C75: 3,750.
    cents(rothIraAllowed(247_000, rothRange(2026, "mfj"), 7_500), 3_750);
  });

  it("limits/C80 [LIM-12] MFS lived together, start, range function only (45, MAGI 0): 7,500", () => {
    // Range 0–10,000 fed in. At the start: 7,500.
    cents(rothIraAllowed(0, MFS_LIVED_TOGETHER, 7_500), 7_500);
  });

  it("limits/C81 [LIM-12] MFS half, range function only (MAGI 5,000): 3,750", () => {
    // 7,500 × 5,000 / 10,000 = 3,750 off; 3,750.
    cents(rothIraAllowed(5_000, MFS_LIVED_TOGETHER, 7_500), 3_750);
  });

  it("limits/C82 [LIM-12] MFS floor, range function only (MAGI 9,999): 200", () => {
    // 7,499.25 off; 0.75 → 10 → floored to 200.
    cents(rothIraAllowed(9_999, MFS_LIVED_TOGETHER, 7_500), 200);
  });

  it("limits/C83 [LIM-12] MFS out, range function only (MAGI 10,000): 0", () => {
    cents(rothIraAllowed(10_000, MFS_LIVED_TOGETHER, 7_500), 0);
  });

  it("limits/C84 [LIM-12] MFS apart = Single, range function only (45, MAGI 160,500): 3,750", () => {
    // Lived apart all year: treated as single (408A(c)(3)(C)), so the
    // Single range is fed in. As C65: 3,750.
    cents(rothIraAllowed(160_500, rothRange(2026, "single"), 7_500), 3_750);
  });

  it("limits/C85 [LIM-12] Pub 590-A Worksheet 2-2 (2025 Single, 45, MAGI 151,000): 6,540", () => {
    // 150,000–165,000 (Notice 2024-80 p.5): 7,000 × 1,000 / 15,000 =
    // 466.67 off; 6,533.33 rounds up to 6,540.
    cents(roth(2025, "single", 45, 151_000), 6_540);
  });

  it("limits/C86 [LIM-12] exact ratio (2026 Single, 45, MAGI 154,100): 6,950", () => {
    // 7,500 × 1,100 / 15,000 = 550 exactly; 6,950. The worksheet's ratio
    // "to at least three places" (0.073) gives 547.50 → 6,960; Ledgr keeps
    // the exact ratio, as the statute does (spec Q-2).
    cents(roth(2026, "single", 45, 154_100), 6_950);
  });

  it("limits/C87 [LIM-12] worksheet rounding, base set by pay (2026 Single, 45, pay 3,335, MAGI 160,500): 1,670", () => {
    // Base min(7,500, 3,335) = 3,335. 3,335 × 7,500 / 15,000 = 1,667.50
    // off; 1,667.50 rounded up to the next $10 = 1,670: Pub 590-A (2025)
    // Worksheet 2-2 line 8 ("Round the result up to the nearest $10") and
    // the Form 8606 instructions' worksheet line 9 both give this.
    // Disclosed: the statute, 219(g)(2)(C) via 408A(c)(3)(A), rounds the
    // reduction down to $10 (1,660), giving 3,335 − 1,660 = 1,675. Ledgr
    // follows the worksheets (verdict D3).
    const base = iraBase(2026, 45, 3_335);
    cents(base, 3_335);
    cents(rothIraAllowed(160_500, rothRange(2026, "single"), base), 1_670);
  });

  it("limits/C87b [LIM-12] the same rule the other way (pay 3,335, MAGI 160,800): 1,610", () => {
    // 3,335 × 7,800 / 15,000 = 1,734.20 off; 1,600.80 rounds up to 1,610
    // (Worksheet 2-2 line 8; Form 8606 worksheet line 9). The statute's
    // reading: 1,730 off, 1,605, so here Ledgr is 5 above it.
    cents(
      rothIraAllowed(
        160_800,
        rothRange(2026, "single"),
        iraBase(2026, 45, 3_335),
      ),
      1_610,
    );
  });

  // C88: phase-out first, then the traditional money. 2026 MFJ, 45, MAGI
  // 247,000, 5,000 traditional. Worksheet 2-2: line 8 on 7,500 = 3,750;
  // lines 9–11, 7,500 − 5,000 = 2,500; the smaller wins: 2,500 (reducing
  // the base first would give the wrong 1,250). Today the text says 3,750
  // (verdict D5).
  xfail({
    id: "limits/C88 [LIM-13]",
    todo: "v0.11 Limits \"Roth 'Allowed today' stops at worksheet line 8\" (verdict D5)",
    run: () => allowedDirect("MFJ", 45, 247_000, 5_000),
    expected: 2_500,
    today: 3_750,
  });

  it("limits/C89 [LIM-12] conversion income left out of MAGI, range function only (2026 MFJ, 45, AGI 300,000 with 80,000 conversion): 7,500", () => {
    // Roth MAGI leaves out conversion income (408A(c)(3)(B)(i); Worksheet
    // 2-1): 300,000 − 80,000 = 220,000, under 242,000. Ledgr has no
    // conversion item in its MAGI parts, so the net MAGI is fed in.
    cents(rothIraAllowed(220_000, rothRange(2026, "mfj"), 7_500), 7_500);
  });
});

// ---------------------------------------------------------------------------
// I. HSA (IRC 223(b); Pub 969 (2025))
// ---------------------------------------------------------------------------

const SELF = "self_only";
const FAMILY = "family";

/** One person's HSA row far over any limit, capped. */
function hsaLimit(
  year: number,
  age: number,
  coverage: string,
  employer = 0,
): number {
  const r = row({
    personId: 1,
    accountType: "hsa",
    hsaCoverageType: coverage,
    regularAnnual: 20_000,
    employerAnnual: employer,
  });
  return cap(year, [person(1, year, age, 150_000)], [r]).get(r.id)!
    .cappedAnnual;
}

/** A married couple's HSA rows (MFJ), capped; `null` = no HSA. */
function coupleHsa(
  year: number,
  ages: [number, number],
  rows: [
    { coverage: string; amount: number } | null,
    { coverage: string; amount: number } | null,
  ],
): (number | null)[] {
  const made = rows.map((r, k) =>
    r
      ? row({
          personId: k + 1,
          accountType: "hsa",
          hsaCoverageType: r.coverage,
          regularAnnual: r.amount,
        })
      : null,
  );
  const capped = cap(
    year,
    [person(1, year, ages[0], 150_000), person(2, year, ages[1], 150_000)],
    made.filter((r): r is CapRow => r !== null),
    "MFJ",
  );
  return made.map((r) => (r ? capped.get(r.id)!.cappedAnnual : null));
}
const total = (xs: (number | null)[]) =>
  xs.reduce<number>((s, x) => s + (x ?? 0), 0);

describe("limits: HSA", () => {
  it("limits/C118 [LIM-08] self-only (2026, 54): 4,400", () => {
    // Rev. Proc. 2025-19 § 2.01(1): 4,400. Under 55, no catch-up.
    cents(hsaLimit(2026, 54, SELF), 4_400);
  });

  it("limits/C119 [LIM-08] family (2026, 54): 8,750", () => {
    // Rev. Proc. 2025-19 § 2.01(1): 8,750.
    cents(hsaLimit(2026, 54, FAMILY), 8_750);
  });

  it("limits/C120 [LIM-09] catch-up (2026, self-only, 55): 5,400", () => {
    // 223(b)(3): 4,400 + 1,000 = 5,400.
    cents(hsaLimit(2026, 55, SELF), 5_400);
  });

  it("limits/C121 [LIM-09] family catch-up (2026, family, unmarried, 55): 9,750", () => {
    // 8,750 + 1,000 = 9,750.
    cents(hsaLimit(2026, 55, FAMILY), 9_750);
  });

  it("limits/C122 [LIM-09] 2025 self-only at 55 (Pub 969): 5,300", () => {
    // Rev. Proc. 2024-25 4,300 + 1,000 = 5,300, as Pub 969 (2025) prints.
    cents(hsaLimit(2025, 55, SELF), 5_300);
  });

  it("limits/C123 [LIM-09] 2025 spouses both 55, family, an HSA each (Pub 969): 10,550", () => {
    // One family limit shared, each spouse's catch-up in their own HSA
    // (223(b)(5); Pub 969 (2025)): 8,550 + 1,000 + 1,000 = 10,550.
    const capped = coupleHsa(
      2025,
      [55, 55],
      [
        { coverage: FAMILY, amount: 8_000 },
        { coverage: FAMILY, amount: 8_000 },
      ],
    );
    cents(total(capped), 10_550);
  });

  it("limits/C124 [LIM-09] 2026 spouses both 55, family, an HSA each: 10,750", () => {
    // 8,750 + 1,000 + 1,000 = 10,750.
    const capped = coupleHsa(
      2026,
      [55, 55],
      [
        { coverage: FAMILY, amount: 8_000 },
        { coverage: FAMILY, amount: 8_000 },
      ],
    );
    cents(total(capped), 10_750);
  });

  it("limits/C125 [LIM-09] catch-up only in own HSA (2026, spouses 55, one HSA): 9,750", () => {
    // The spouse without an HSA can't use their catch-up in the other's
    // (223(b)(3); Pub 969): 8,750 + 1,000 = 9,750.
    const capped = coupleHsa(
      2026,
      [55, 55],
      [{ coverage: FAMILY, amount: 20_000 }, null],
    );
    cents(total(capped), 9_750);
  });

  it("limits/C126 [LIM-08] default split (2026, spouses 40, family): 4,375 each", () => {
    // With no agreement the family limit splits equally (223(b)(5)(B)(ii)):
    // 8,750 / 2 = 4,375 each.
    const [a, b] = coupleHsa(
      2026,
      [40, 40],
      [
        { coverage: FAMILY, amount: 8_750 },
        { coverage: FAMILY, amount: 8_750 },
      ],
    );
    cents({ a: a!, b: b! }, { a: 4_375, b: 4_375 });
  });

  it("limits/C127 [LIM-08] any split allowed (2026, spouses 40, agreed 8,750 / 0): 8,750", () => {
    // Spouses may agree any division (223(b)(5)(B)(ii)): 8,750 and 0.
    const [a, b] = coupleHsa(
      2026,
      [40, 40],
      [
        { coverage: FAMILY, amount: 8_750 },
        { coverage: FAMILY, amount: 0 },
      ],
    );
    cents({ a: a!, b: b! }, { a: 8_750, b: 0 });
  });

  it("limits/C128 [LIM-08] family beats self-only (2026, spouses 40, one family, one self-only): 8,750 combined", () => {
    // Either spouse with family coverage: both are treated as having
    // family coverage (223(b)(5)(A)): one 8,750 limit, not 8,750 + 4,400.
    const capped = coupleHsa(
      2026,
      [40, 40],
      [
        { coverage: FAMILY, amount: 8_000 },
        { coverage: SELF, amount: 8_000 },
      ],
    );
    cents(total(capped), 8_750);
  });

  it("limits/C129 [LIM-08] two self-only (2026, spouses 40): 8,800 combined", () => {
    // No family coverage, nothing shared: 4,400 × 2 = 8,800.
    const capped = coupleHsa(
      2026,
      [40, 40],
      [
        { coverage: SELF, amount: 8_000 },
        { coverage: SELF, amount: 8_000 },
      ],
    );
    cents(total(capped), 8_800);
  });

  it("limits/C130 [LIM-08] spouse on Medicare (2026, A 45 family, B on Medicare): A 8,750", () => {
    // B isn't an eligible individual, so no part of the limit goes to B
    // (Pub 969): A takes the whole family 8,750. B has no HSA row.
    const [a] = coupleHsa(
      2026,
      [45, 70],
      [{ coverage: FAMILY, amount: 20_000 }, null],
    );
    cents(a!, 8_750);
  });

  it("limits/C134 [LIM-08] last-month rule, December coverage fed in (Pub 969 Ex. 1; 2025, family from Dec 1, 53): 8,550", () => {
    // Family coverage on Dec 1 counts as family all year (223(b)(8); Pub
    // 969 (2025) Example 1): the full 8,550. Ledgr takes one coverage per
    // row, so the December coverage (family) is what's fed in.
    cents(hsaLimit(2025, 53, FAMILY), 8_550);
  });

  it("limits/C139 [LIM-08] last-month rule, December coverage fed in (2026, self-only Jan–Oct, family Nov–Dec, 40): 8,750", () => {
    // Family on Dec 1 → family limit for the year: 8,750.
    cents(hsaLimit(2026, 40, FAMILY), 8_750);
  });

  it("limits/C140 [LIM-08] last-month rule, December coverage fed in (2026, self-only Jan–Mar, none Apr–Nov, family from Dec 1, 40): 8,750", () => {
    // Eligible and family on Dec 1 → 8,750 for the year (223(b)(8)).
    cents(hsaLimit(2026, 40, FAMILY), 8_750);
  });

  it("limits/C141 [LIM-08] cafeteria payroll is employer money (2026, family, 1,500 employer, 40): personal room 7,250", () => {
    // Employer and cafeteria-plan money count toward the limit (Pub 969):
    // 8,750 − 1,500 = 7,250 left for the person.
    cents(hsaLimit(2026, 40, FAMILY, 1_500), 7_250);
  });
});

// ---------------------------------------------------------------------------
// Hand worksheet (`reviews/2026-11-01/hand-worksheet.md` § Limits)
// ---------------------------------------------------------------------------

describe("limits: hand worksheet", () => {
  it("limits/HW-LIM [LIM-01] 2026 limits at Dec 31 ages 26–64: 401(k), IRA, HSA self-only and family", () => {
    // 401(k) 24,500, + 8,000 at 50–59 and 64, + 11,250 at 60–63.
    // IRA 7,500, + 1,100 from 50 (219(b)(5)(B); Notice 2025-67 p.4).
    // HSA 4,400 / 8,750, + 1,000 from 55.
    const limits = limitsFor(2026);
    const at = (age: number) => ({
      "401k": resolveIrsLimit("401k", age, null, limits),
      ira: resolveIrsLimit("ira", age, null, limits),
      hsaSelf: resolveIrsLimit("hsa", age, SELF, limits),
      hsaFamily: resolveIrsLimit("hsa", age, FAMILY, limits),
    });
    const want: Record<number, ReturnType<typeof at>> = {
      26: { "401k": 24_500, ira: 7_500, hsaSelf: 4_400, hsaFamily: 8_750 },
      49: { "401k": 24_500, ira: 7_500, hsaSelf: 4_400, hsaFamily: 8_750 },
      50: { "401k": 32_500, ira: 8_600, hsaSelf: 4_400, hsaFamily: 8_750 },
      55: { "401k": 32_500, ira: 8_600, hsaSelf: 5_400, hsaFamily: 9_750 },
      60: { "401k": 35_750, ira: 8_600, hsaSelf: 5_400, hsaFamily: 9_750 },
      63: { "401k": 35_750, ira: 8_600, hsaSelf: 5_400, hsaFamily: 9_750 },
      64: { "401k": 32_500, ira: 8_600, hsaSelf: 5_400, hsaFamily: 9_750 },
    };
    for (const [age, figures] of Object.entries(want))
      cents(at(Number(age)), figures);
  });

  it("limits/HW-IRA-3000 [LIM-11] part-timer on 3,000 of wages (2026, 45): IRA 3,000", () => {
    // 219(b)(1): min(7,500, 3,000 of taxable compensation) = 3,000.
    cents(iraLimit(2026, 45, 3_000), 3_000);
  });
});
