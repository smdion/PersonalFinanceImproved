/**
 * Answer key, retirement: required minimum distributions and qualified
 * charitable distributions (`.scratch/docs/drafts/answer-key.md`
 * § Retirement rules; rulings in `reviews/2026-11-01/rebuild/
 * retirement-verdicts.md`, rules and worked cases in
 * `reviews/2026-11-01/specs/retirement-rules.md` § 4.1, § 5, § 6, § 14.1
 * to § 14.4). Ids are the spec's own, prefixed `ret/` (the same letters
 * repeat in other areas); the bracketed part is the docs/CALCULATIONS.md
 * row.
 *
 * Every figure is worked by hand from the rule, never read from `src/`:
 * - Start age: IRC 401(a)(9)(C)(v) as amended by SECURE 2.0 § 107 (72 for
 *   those born 7/1/1949 to 1950, 73 for 1951 to 1959, 75 from 1960) and
 *   Treas. Reg. 1.401(a)(9)-2(b)(2); born 1959 is 73 by decision E4 (the
 *   statute reads both; proposed Reg. -2(b)(2)(v) says 73). First
 *   distribution calendar year (FDCY) = the year of that age; the
 *   required beginning date is April 1 of the next (Reg. -5(a)(2)(ii)).
 * - Amount: prior December 31 balance ÷ the divisor for this year's age
 *   (Reg. 1.401(a)(9)-5(a)(1), (c)(1)); the divisor is Pub 590-B (2025)
 *   Appendix B Table III (Uniform Lifetime; Reg. -9(c)), unless the spouse
 *   is the sole beneficiary and more than 10 years younger, which uses
 *   Table II (Joint and Last Survivor; Reg. -5(c)(2), -9(d)). Each owner's
 *   own accounts at that owner's age (IRC 401(a)(9)(A); Reg. 1.408-8(a),
 *   (e)(1)(i)); IRAs aggregate per owner; Roth money is excluded during
 *   life (Reg. -5(b)(3); 1.408-8(b)(1)(ii)); no credit for an earlier
 *   year's excess (Reg. -5(a)(6)). Excise 25% of the shortfall (IRC
 *   4974(a)).
 * - QCD: IRC 408(d)(8): 70½ on the date of the distribution ((B)(ii)),
 *   IRAs only ((B)), a per-person limit indexed from 2024 ((A), (G)):
 *   108,000 for 2025 (Notice 2024-80) and 111,000 for 2026 (Notice
 *   2025-67); it counts toward the RMD (Pub 590-B (2025) pp.6, 14).
 *
 * Divisors cited from Pub 590-B (2025) Table III: 73 → 26.5, 74 → 25.5,
 * 75 → 24.6, 76 → 23.7, 78 → 22.0, 80 → 20.2, 90 → 12.2, 120 and over
 * → 2.0. Table II (Reg. 1.401(a)(9)-9(d), the regulation governs where
 * Pub 590-B's printed cell differs, DOC-3): 75/64 → 25.3, 80/69 → 20.9,
 * 73/62 → 27.2, 90/76 → 14.7 (the Pub prints 14.8). The full table is
 * checked cell by cell in `tests/config/rmd-tables.test.ts`; the cases
 * here test the functions.
 *
 * The engine judges age as `year − birthYear` (no birth date), so a case
 * whose rule turns on a date (Q1-Q3, the QCD's 70½) enters only through
 * its year; the date is in the comment. The QCD age gate lives in the
 * engine (`decumulation-year.ts`), so the QCD age cases run one engine
 * year; the limit cases call `computeQcdAmounts` with the shipped
 * year's limit.
 *
 * Not written here (one header for the closed and "not as printed"
 * cases):
 * - ret/R12 (first-year deferral to April 1), ret/R16, ret/R17 (per-plan and
 *   per-type RMDs), ret/R29, ret/R30 (the 10% corrected-in-window excise tier and
 *   a missed first-year RMD): closed, disclosed only, v0.12 Retirement
 *   rules "Disclose always" (bulk group, v0.11 Retirement rules "Answer
 *   key, retirement bulk group").
 * - ret/R1 (born before 7/1/1949: 70½), ret/R8, ret/R10 (the still-working
 *   deferral): not as printed (verdict); Ledgr has no still-working input
 *   and no one born before 1949 reaches a first RMD in a projection.
 * Blocked with an item that unblocks them: the `it.todo`s at the end.
 */
import { describe, expect, it } from "vitest";
import { cents, runOneYear, xfail } from "../fixtures/answer-key";
import {
  computeRmdAmount,
  getRmdFactor,
  getRmdStartAge,
} from "@/lib/config/rmd-tables";
import { enforceOwnerRmds } from "@/lib/calculators/engine/rmd-enforcement";
import {
  computeQcdAmounts,
  totalQcdAmount,
} from "@/lib/calculators/engine/qcd";
import type {
  AccountBalances,
  DecumulationSlot,
  EngineDecumulationYear,
  IndividualAccountInput,
} from "@/lib/calculators/types";
import { shippedTaxTables } from "../helpers/tax-data";
import { acct, household } from "./fixtures/two-person-household";

// ---------------------------------------------------------------------------
// Inputs: invented owners
// ---------------------------------------------------------------------------

/** The first year a person owes an RMD: the year they reach the start
 *  age (Reg. 1.401(a)(9)-5(a)(2)(ii)). */
const fdcy = (birthYear: number) => birthYear + getRmdStartAge(birthYear);

/** The shipped per-person QCD limit for `year` (tax-data, the input under
 *  test; each expectation is the notice's own figure). */
const qcdLimit = (year: 2025 | 2026) => shippedTaxTables(year).qcdAnnualLimit;

/** One owner's QCD this year when they give everything their IRA holds. */
const qcdOf = (iraBalance: number, year: 2025 | 2026) =>
  totalQcdAmount(
    computeQcdAmounts(
      true,
      [{ personId: 1, iraTraditionalBalance: iraBalance }],
      qcdLimit(year),
    ),
  );

/** One engine year (2026, the fixture's first) for owners with the given
 *  birth years, `qcdMaximize` on, flat returns and no Social Security.
 *  Spending comes from a large brokerage first, so the Traditional
 *  balances move only by the RMD and the QCD. */
function engineYear(
  people: { personId: number; name: string; birthYear: number }[],
  accounts: IndividualAccountInput[],
  year = 2026,
): EngineDecumulationYear {
  const input = household(
    [...accounts, acct("Brokerage", "brokerage", 2_000_000, 1, "afterTax")],
    {
      birthYear: people[0]!.birthYear,
      currentAge: 2026 - people[0]!.birthYear,
      socialSecurityEntries: people.map((p) => ({
        personId: p.personId,
        personName: p.name,
        birthYear: p.birthYear,
        startAge: 70,
        annualAmount: 0,
      })),
      perPersonBirthYears: people.map((p) => p.birthYear),
      filingStatus: people.length > 1 ? "MFJ" : "Single",
      annualExpenses: 10_000,
    },
    {
      qcdMaximize: true,
      withdrawalOrder: ["brokerage", "401k", "403b", "ira", "hsa"],
      withdrawalSplits: { brokerage: 1, "401k": 0, "403b": 0, ira: 0, hsa: 0 },
    },
  );
  const row = runOneYear(input, year);
  expect(row.phase).toBe("decumulation");
  return row as EngineDecumulationYear;
}

const ann = (birthYear: number) => [{ personId: 1, name: "Ann", birthYear }];

/** Account balances for `enforceOwnerRmds`: Traditional IRA money only. */
function iraBalances(traditional: number): AccountBalances {
  return {
    "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
    "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
    ira: { structure: "roth_traditional", traditional, roth: 0 },
    hsa: { structure: "single_bucket", balance: 0 },
    brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
  } as AccountBalances;
}

const indKey = (a: { name: string }) => a.name;

/** `enforceOwnerRmds` for owners whose IRAs are `accounts`, after routing
 *  drew `routedFromIra` from the IRA category. */
function ownerRmds(
  owners: { personId: number; required: number }[],
  accounts: IndividualAccountInput[],
  routedFromIra: number,
) {
  const slots: DecumulationSlot[] = routedFromIra
    ? [
        {
          category: "ira",
          withdrawal: routedFromIra,
          traditionalWithdrawal: routedFromIra,
          rothWithdrawal: 0,
        } as DecumulationSlot,
      ]
    : [];
  return enforceOwnerRmds({
    owners: owners.map((o) => ({ ...o, personName: `P${o.personId}` })),
    primaryPersonId: 1,
    slots,
    totalTraditionalWithdrawal: routedFromIra,
    totalWithdrawal: routedFromIra,
    acctBal: iraBalances(accounts.reduce((s, a) => s + a.startingBalance, 0)),
    indAccts: accounts,
    indKey,
    indBal: new Map(accounts.map((a) => [a.name, a.startingBalance])),
  });
}

const NO_JOINT_LIFE =
  'v0.11 Retirement rules "Retirement rules the skeptic confirmed" (verdict K-A: no Joint Life table)';
const QCD_AGE =
  'v0.11 Retirement rules "Retirement rules the skeptic confirmed" (verdict K-C: QCD gate is 70 in the year, not 70½ on the date)';

// ---------------------------------------------------------------------------
// A. When RMDs start (IRC 401(a)(9)(C)(v); SECURE 2.0 § 107)
// ---------------------------------------------------------------------------

describe("answer key: RMD start age and first distribution year", () => {
  it("ret/R2 [RET-01] DOB 1949-07-01: 72", () => {
    // Born on or after 7/1/1949 and before 1951: 72 (SECURE Act § 114;
    // Reg. 1.401(a)(9)-2(b)(2)(iii)).
    expect(getRmdStartAge(1949)).toBe(72);
  });

  it("ret/R3 [RET-01] DOB 1950-12-31: 72, FDCY 2022", () => {
    // 72 in 1950 + 72 = 2022.
    expect(getRmdStartAge(1950)).toBe(72);
    expect(fdcy(1950)).toBe(2022);
  });

  it("ret/R4 [RET-01] DOB 1951-01-01: 73, FDCY 2024 (RBD 2025-04-01)", () => {
    // Born 1951-1959: 73 (SECURE 2.0 § 107(a); 401(a)(9)(C)(v)(I)).
    // 1951 + 73 = 2024; the first RMD may wait to April 1, 2025.
    expect(getRmdStartAge(1951)).toBe(73);
    expect(fdcy(1951)).toBe(2024);
  });

  it("ret/R5 [RET-01] DOB 1958-12-31: 73, FDCY 2031", () => {
    // 1958 + 73 = 2031.
    expect(getRmdStartAge(1958)).toBe(73);
    expect(fdcy(1958)).toBe(2031);
  });

  it("ret/R6 [RET-01] DOB 1959-06-15: 73 by decision E4, FDCY 2032", () => {
    // The statute gives 1959 both 73 and 75 (401(a)(9)(C)(v)(I), (II));
    // Reg. -2(b)(2)(v) is reserved, the proposed rule says 73. Decision
    // E4: 73, disclosed (spec RMD-2). 1959 + 73 = 2032.
    expect(getRmdStartAge(1959)).toBe(73);
    expect(fdcy(1959)).toBe(2032);
  });

  it("ret/R7 [RET-01] DOB 1960-01-01: 75, FDCY 2035", () => {
    // From 1960: 75 (401(a)(9)(C)(v)(II)). 1960 + 75 = 2035; RBD
    // 2036-04-01.
    expect(getRmdStartAge(1960)).toBe(75);
    expect(fdcy(1960)).toBe(2035);
  });

  it("ret/R9 [RET-01] born 1953-08-01, 401(k), still working, owns 6%: FDCY 2026", () => {
    // A more-than-5% owner gets no still-working deferral (401(a)(9)(C)
    // (ii); Reg. -2(b)(3); Pub 575 (2025) p.32), so the 401(k)'s FDCY is
    // the year of 73: 1953 + 73 = 2026. On a 1,000 balance at 73:
    // 1,000 ÷ 26.5 = 37.735… → 37.74. Ledgr gives no one the deferral
    // (ret/R8, ret/R10 are out), so this owner's answer is the plain one.
    expect(fdcy(1953)).toBe(2026);
    cents(computeRmdAmount(1_000, 2026 - 1953)!, 37.74);
  });
});

// ---------------------------------------------------------------------------
// B. How much (Reg. 1.401(a)(9)-5; Pub 590-B (2025) Tables II and III)
// ---------------------------------------------------------------------------

describe("answer key: the RMD amount", () => {
  it("ret/P1 [RET-02] 100,000 at 75, spouse 6 years younger: 4,065.04 (Pub 590-B p.8 prints 4,065)", () => {
    // Spouse sole beneficiary but only 6 years younger: Table III.
    // 100,000 ÷ 24.6 = 4,065.040… → 4,065.04.
    expect(getRmdFactor(75)).toBe(24.6);
    cents(computeRmdAmount(100_000, 75)!, 4_065.04);
  });

  describe("ret/P2 [RET-02]", () => {
    // Same, spouse 64, 11 years younger and sole beneficiary: Table II
    // 75/64 = 25.3 (Pub 590-B p.8's own example). 100,000 ÷ 25.3 =
    // 3,952.569… → 3,952.57 (Pub prints 3,953). Today Table III: 4,065.04.
    xfail({
      id: "ret/P2 [RET-02]",
      todo: NO_JOINT_LIFE,
      run: () => computeRmdAmount(100_000, 75)!,
      expected: 3_952.57,
      today: 4_065.04,
    });
  });

  it("ret/P3 [RET-03] Justin, 73 on 12/15/2025, 2024 balance 38,400: 1,449.06 (Pub 590-B p.12 prints 1,450)", () => {
    // Born 1952: start age 73, so 2025 is his FDCY. 38,400 ÷ 26.5 =
    // 1,449.056… → 1,449.06; the Pub rounds up to 1,450 (spec RMD-21: no
    // rounding is required, the rule is "at least").
    expect(fdcy(1952)).toBe(2025);
    cents(computeRmdAmount(38_400, 73)!, 1_449.06);
  });

  it("ret/P4 [RET-03] Justin 2026, balance 34,800 at 74: 1,364.71, not the Pub's 1,313 (DOC-1)", () => {
    // He is 74 in 2026: 34,800 ÷ 25.5 = 1,364.705… → 1,364.71. Pub 590-B
    // p.12 divides by 26.5 again (1,313), a Pub error: the factor is
    // looked up fresh each year (Reg. -5(c)(1)).
    expect(getRmdFactor(74)).toBe(25.5);
    cents(computeRmdAmount(34_800, 74)!, 1_364.71);
  });

  it("ret/R11 [RET-03] born 1951, retires 2027, 401(k) 600,000 at 12/31/2026, 76 in 2027: 25,316.46", () => {
    // Still working past 73 defers the 401(k) to the year he retires
    // (Reg. -2(b)(1)): FDCY 2027, RBD 2028-04-01. 2027 − 1951 = 76:
    // 600,000 ÷ 23.7 = 25,316.455… → 25,316.46. Ledgr has no
    // still-working input (it would have taken RMDs from 2024), but on
    // the 12/31/2026 balance the 2027 figure is the same.
    expect(getRmdFactor(76)).toBe(23.7);
    cents(computeRmdAmount(600_000, 2027 - 1951)!, 25_316.46);
  });

  it("ret/R13 [RET-03] H 80 with IRA 300,000, W 78 with IRA 100,000, 2026: 19,396.94 (pooled at H's age: 19,801.98)", () => {
    // Per owner at their own age (401(a)(9)(A); spec RMD-22): H 300,000 ÷
    // 20.2 = 14,851.485… → 14,851.49; W 100,000 ÷ 22.0 = 4,545.454… →
    // 4,545.45; together 19,396.94. Pooled at H's age it would be
    // 400,000 ÷ 20.2 = 19,801.98. Through the engine: H born 1946, W 1948.
    const year = engineYear(
      [
        { personId: 1, name: "Ann", birthYear: 1946 },
        { personId: 2, name: "Bo", birthYear: 1948 },
      ],
      [acct("H IRA", "ira", 300_000, 1), acct("W IRA", "ira", 100_000, 2)],
    );
    const byPerson = new Map(
      (year.rmdByPerson ?? []).map((p) => [p.personId, p.amount]),
    );
    cents(byPerson.get(1)!, 14_851.49);
    cents(byPerson.get(2)!, 4_545.45);
    cents(year.rmdAmount, 19_396.94);
  });

  it("ret/R14 [RET-04] R13, routing draws 19,396.94 from W's IRA: H's 14,851.49 still comes from H's", () => {
    // One spouse's distribution never meets the other's RMD (Reg. 1.408-8
    // (e)(2)(i); spec RMD-23). Taken as routed, H would be short
    // 14,851.49. Ledgr pins each owner's RMD to that owner's own IRA:
    // H 14,851.49, W 4,545.45, and the household draw stays 19,396.94
    // (moved between owners, no added income), with no shortfall.
    const h = acct("H IRA", "ira", 300_000, 1);
    const w = acct("W IRA", "ira", 100_000, 2);
    const r = ownerRmds(
      [
        { personId: 1, required: 14_851.49 },
        { personId: 2, required: 4_545.45 },
      ],
      [h, w],
      19_396.94,
    );
    cents(r.pins.get("H IRA")!, 14_851.49);
    cents(r.pins.get("W IRA")!, 4_545.45);
    cents(r.totalTraditionalWithdrawal, 19_396.94);
    cents(r.rmdShortfallAmount, 0);
  });

  it("ret/R15 [RET-04] 75 with two IRAs, 60,000 and 40,000: 4,065.04, from either", () => {
    // Computed per IRA, 60,000 ÷ 24.6 = 2,439.02 and 40,000 ÷ 24.6 =
    // 1,626.02, 4,065.04 together, and the total may come from any of the
    // owner's IRAs (Reg. 1.408-8(e)(1)(i); Pub 590-B p.12). Routing that
    // drew it all from the IRA category meets it: no override, no extra
    // draw, no shortfall.
    cents(computeRmdAmount(60_000, 75)!, 2_439.02);
    cents(computeRmdAmount(40_000, 75)!, 1_626.02);
    cents(computeRmdAmount(100_000, 75)!, 4_065.04);
    const r = ownerRmds(
      [{ personId: 1, required: 4_065.04 }],
      [acct("IRA A", "ira", 60_000, 1), acct("IRA B", "ira", 40_000, 1)],
      4_065.04,
    );
    expect(r.rmdOverrodeRouting).toBe(false);
    cents(r.totalTraditionalWithdrawal, 4_065.04);
    cents(r.rmdShortfallAmount, 0);
  });

  describe("ret/R18 [RET-02]", () => {
    // Owner 80, spouse 69, sole beneficiary: 11 years, so Table II 80/69
    // = 20.9. 1,000,000 ÷ 20.9 = 47,846.889… → 47,846.89. Today Table III
    // 20.2: 49,504.95.
    xfail({
      id: "ret/R18 [RET-02]",
      todo: NO_JOINT_LIFE,
      run: () => computeRmdAmount(1_000_000, 80)!,
      expected: 47_846.89,
      today: 49_504.95,
    });
  });

  it("ret/R19 [RET-02] owner 80, spouse 70, exactly 10 years: Table III, 49,504.95", () => {
    // Table II needs more than 10 years (Reg. -5(c)(2)(ii)): 1,000,000 ÷
    // 20.2 = 49,504.950… → 49,504.95.
    cents(computeRmdAmount(1_000_000, 80)!, 49_504.95);
  });

  describe("ret/R20 [RET-02]", () => {
    // Owner 73, spouse 62, sole beneficiary: 11 years, Table II 73/62 =
    // 27.2 (both the regulation and the Pub). 800,000 ÷ 27.2 = 29,411.764…
    // → 29,411.76. Today Table III 26.5: 30,188.68.
    xfail({
      id: "ret/R20 [RET-02]",
      todo: NO_JOINT_LIFE,
      run: () => computeRmdAmount(800_000, 73)!,
      expected: 29_411.76,
      today: 30_188.68,
    });
  });

  it("ret/R21 [RET-02] owner 73, spouse 63, 10 years: 30,188.68", () => {
    // Table III: 800,000 ÷ 26.5 = 30,188.679… → 30,188.68.
    cents(computeRmdAmount(800_000, 73)!, 30_188.68);
  });

  it("ret/R22 [RET-02] owner 80, spouse 69, spouse and a child co-beneficiaries: 49,504.95", () => {
    // Not the sole beneficiary, so Table III whatever the gap (Reg.
    // -5(c)(2)(i)): 1,000,000 ÷ 20.2 = 49,504.95.
    cents(computeRmdAmount(1_000_000, 80)!, 49_504.95);
  });

  describe("ret/R24 [RET-02]", () => {
    // Owner 90, spouse 76, sole beneficiary: Table II. The regulation's
    // cell is 14.7 (Reg. -9(d)); Pub 590-B Table II prints 14.8 (DOC-3;
    // the regulation governs). 500,000 ÷ 14.7 = 34,013.605… → 34,013.61
    // (the Pub cell would give 33,783.78). Today Table III 12.2:
    // 500,000 ÷ 12.2 = 40,983.606… → 40,983.61.
    xfail({
      id: "ret/R24 [RET-02]",
      todo: NO_JOINT_LIFE,
      run: () => computeRmdAmount(500_000, 90)!,
      expected: 34_013.61,
      today: 40_983.61,
    });
  });

  it("ret/R25 [RET-02] age 120, 100,000: 50,000", () => {
    // Table III's last row is "120 and over", 2.0: 100,000 ÷ 2.0 =
    // 50,000, and the same at 121.
    cents(computeRmdAmount(100_000, 120)!, 50_000);
    cents(computeRmdAmount(100_000, 121)!, 50_000);
  });

  it("ret/R26 [RET-03] Roth IRA 1,000,000 at 80 and Roth 401(k) 200,000: 0", () => {
    // Roth IRAs and designated Roth accounts owe nothing during the
    // owner's life (Reg. -5(b)(3); Reg. 1.408-8(b)(1)(ii); SECURE 2.0
    // § 325 for the Roth 401(k)). Born 1946, 80 in 2026, through the
    // engine: no RMD.
    const year = engineYear(ann(1946), [
      acct("Roth IRA", "ira", 1_000_000, 1, "taxFree"),
      acct("Roth 401k", "401k", 200_000, 1, "taxFree"),
    ]);
    cents(year.rmdAmount, 0);
    expect(year.rmdOverrodeRouting).toBe(false);
  });

  it("ret/R27 [RET-03] 75 with 400,000, takes 30,000: the next RMD gets no credit for the 13,739.84 excess", () => {
    // 2026: 400,000 ÷ 24.6 = 16,260.16; taking 30,000 is 13,739.84 over.
    // An excess earns no credit in a later year (Reg. -5(a)(6)): with no
    // growth, 2027 is 370,000 at 76, 370,000 ÷ 23.7 = 15,611.814… →
    // 15,611.81, not 15,611.81 − 13,739.84 = 1,871.97.
    cents(computeRmdAmount(400_000, 75)!, 16_260.16);
    cents(computeRmdAmount(370_000, 76)!, 15_611.81);
  });

  it("ret/R28 [RET-07] shortfall 10,000: excise 2,500", () => {
    // 25% of the shortfall (IRC 4974(a)): 2,500. An owner due 10,000 with
    // no account to pay it from is short 10,000, priced in the warning.
    const r = ownerRmds([{ personId: 1, required: 10_000 }], [], 0);
    cents(r.rmdShortfallAmount, 10_000);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("~$2500");
  });

  it("ret/R31 [RET-07] shortfall 0: excise 0", () => {
    // The IRA pays the whole 4,065.04: nothing short, no excise warning.
    const r = ownerRmds(
      [{ personId: 1, required: 4_065.04 }],
      [acct("IRA", "ira", 100_000, 1)],
      0,
    );
    cents(r.rmdShortfallAmount, 0);
    expect(r.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C. QCD age (IRC 408(d)(8)(B)(ii): 70½ on the date; audit RT11)
// ---------------------------------------------------------------------------

describe("answer key: QCD at 70½", () => {
  // Each owner holds a 5,000 IRA and gives it all, in 2026. The engine's
  // gate is 70 in the year (`QCD_MIN_ELIGIBILITY_AGE`, disclosed at
  // `fixed-by-law.ts:175`): owners born in 1956 or earlier get the QCD.
  it("ret/Q2 [RET-09] DOB 1955-08-15, QCD on 2026-02-15 (70½ that day): a QCD", () => {
    // 70½ on 2026-02-15 (six months after the 70th birthday on
    // 2025-08-15; the day itself is UNSOURCED-1): a QCD of 5,000. Ledgr
    // gets it by the year model (2026 − 1955 = 71), and still would with
    // a month split (decision D12.4).
    cents(
      engineYear(ann(1955), [acct("IRA", "ira", 5_000, 1)]).qcdAmount,
      5_000,
    );
  });

  it("ret/Q2:70 [RET-09] DOB 1956-03-01, QCD in December 2026, 70 in the year: a QCD (RT11)", () => {
    // 70 on 2026-03-01, 70½ on 2026-09-01: a December QCD is allowed in
    // the year of 70. With Q2:69 this pins the year the engine's gate
    // opens: a gate moved to 71 (the RT11 mutant) gives 0 here.
    cents(
      engineYear(ann(1956), [acct("IRA", "ira", 5_000, 1)]).qcdAmount,
      5_000,
    );
  });

  it("ret/Q2:69 [RET-09] DOB 1957-03-01, 69 in 2026: no QCD", () => {
    // 70½ on 2027-09-01: no date in 2026 qualifies under any reading, so
    // nothing comes out as a QCD.
    cents(engineYear(ann(1957), [acct("IRA", "ira", 5_000, 1)]).qcdAmount, 0);
  });

  // ret/Q1 [RET-09]: same owner as Q2, QCD on 2026-02-14, a day before
  // 70½: not a QCD, the 5,000 is a taxable distribution
  // (408(d)(8)(B)(ii)); decided 0, Ledgr gives 5,000 today. Not an
  // `it.fails`: its engine input is Q2's (birth year 1955, 2026), and Ledgr
  // has no QCD date, so no fix to the age gate alone could make it give 0
  // (owner rule 2026-11-02: a case that can't fail for the right reason is
  // an `it.todo` until its input exists).
  it.todo(
    'ret/Q1: blocked on v0.11 Retirement rules "Add: survivor benefit and first death" (its "a chosen QCD amount", with the QCD date), then v0.11 "Retirement rules the skeptic confirmed" (K-C)',
  );

  describe("ret/Q3 [RET-09]", () => {
    // DOB 1956-11-20, QCD in December 2026: 70 on 2026-11-20, 70½ only on
    // 2027-05-20, so not a QCD. The year model's "70 in the year" passes
    // it (a July-December birth gets one year of QCD the law bars): 5,000.
    xfail({
      id: "ret/Q3 [RET-09]",
      todo: QCD_AGE,
      run: () =>
        engineYear(ann(1956), [acct("IRA", "ira", 5_000, 1)]).qcdAmount,
      expected: 0,
      today: 5_000,
    });
  });

  it("ret/Q9 [RET-09] 72, before the FDCY, QCD 10,000 in 2026: allowed, and no credit against the 2027 RMD", () => {
    // Born 1954: 72 in 2026, first RMD in 2027 at 73. A QCD before the
    // FDCY is allowed (408(d)(8)(B)(ii) asks only 70½; spec QCD-2), and
    // earns no credit later (Reg. -5(a)(6)). IRA 10,000 given in full;
    // the 401(k)'s 500,000 is untouched in 2026 (spending is from the
    // brokerage, no growth), so 2027's RMD is 500,000 ÷ 26.5 = 18,867.924…
    // → 18,867.92, not 8,867.92.
    const accounts = [
      acct("IRA", "ira", 10_000, 1),
      acct("401k", "401k", 500_000, 1),
    ];
    const y2026 = engineYear(ann(1954), accounts, 2026);
    cents(y2026.qcdAmount, 10_000);
    cents(y2026.rmdAmount, 0);
    const y2027 = engineYear(ann(1954), accounts, 2027);
    cents(y2027.rmdAmount, 18_867.92);
  });
});

// ---------------------------------------------------------------------------
// D. QCD limit, per person (IRC 408(d)(8)(A), (G); Notices 2024-80,
//    2025-67)
// ---------------------------------------------------------------------------

describe("answer key: the QCD limit", () => {
  it("ret/Q4 [RET-09] 75, gives 120,000 with an RMD of 15,000: 111,000 excluded, 9,000 income, RMD met", () => {
    // 2026 limit 111,000 (Notice 2025-67): the IRA's 120,000 gift is a QCD
    // up to 111,000; the other 9,000 is an ordinary distribution (Pub
    // 590-B p.14; spec QCD-5). 111,000 ≥ the 15,000 RMD, so it's met
    // (QCD-6).
    cents(qcdOf(120_000, 2026), 111_000);
    // Through the engine: born 1951, IRA 369,000 (369,000 ÷ 24.6 =
    // 15,000.00 exactly). The QCD of 111,000 meets the 15,000 RMD, so no
    // Traditional draw is forced for it.
    const year = engineYear(ann(1951), [acct("IRA", "ira", 369_000, 1)]);
    cents(year.qcdAmount, 111_000);
    cents(year.rmdAmount, 15_000);
    cents(year.rmdShortfallAmount, 0);
    expect(year.rmdOverrodeRouting).toBe(false);
  });

  it("ret/Q5 [RET-09] 2025, QCD 108,000: 108,000 excluded", () => {
    // 2025 limit 108,000 (Notice 2024-80; indexed under IRC 408(d)(8)(G)).
    // An IRA giving 108,000 is all QCD; a dollar more is over the limit.
    cents(qcdOf(108_000, 2025), 108_000);
    cents(qcdOf(108_001, 2025), 108_000);
  });

  it("ret/Q7 [RET-09] MFJ 2026, H's IRA gives 150,000, W's 0: 111,000 excluded, 39,000 taxable", () => {
    // Each spouse has their own limit, from their own IRAs, and an unused
    // one can't pass to the other (spec QCD-4; Pub 590-B p.14): H 111,000,
    // W nothing; 150,000 − 111,000 = 39,000 is income. A joint 222,000
    // limit would exclude all 150,000.
    const r = computeQcdAmounts(
      true,
      [
        { personId: 1, iraTraditionalBalance: 150_000 },
        { personId: 2, iraTraditionalBalance: 0 },
      ],
      qcdLimit(2026),
    );
    expect(r.map((p) => p.personId)).toEqual([1]);
    cents(totalQcdAmount(r), 111_000);
  });

  it("ret/Q8 [RET-09] MFJ 2026, each gives 111,000 from their own IRA: 222,000", () => {
    // Two limits of 111,000: 222,000 excluded.
    const r = computeQcdAmounts(
      true,
      [
        { personId: 1, iraTraditionalBalance: 111_000 },
        { personId: 2, iraTraditionalBalance: 111_000 },
      ],
      qcdLimit(2026),
    );
    cents(totalQcdAmount(r), 222_000);
  });

  it("ret/Q10 [RET-09] MFS living together, 75, QCD 50,000: 50,000", () => {
    // The limit is per person whatever the filing status (408(d)(8)(A)
    // has no status test): 50,000 under 111,000, all excluded.
    // `computeQcdAmounts` takes no status.
    cents(qcdOf(50_000, 2026), 50_000);
  });
});

// ── Blocked, with an item that unblocks them ────────────────────────────

describe("answer key: RMD and QCD cases blocked on a feature", () => {
  // Inputs and figures for each are in the answer key's Retirement rules.
  const FIRST_DEATH =
    'v0.11 Retirement rules "Add: survivor benefit and first death"';
  // ret/R23: owner 80, spouse 65 (sole beneficiary) dies March 2026: 2026
  // stays on Table II 23.8 (marital status is set on January 1, Reg.
  // -5(c)(2)(iii)); 2027 Table III at 81, 19.4. Needs a death date.
  it.todo(`ret/R23: blocked on ${FIRST_DEATH} (a spouse's death date)`);
  // ret/R32: owner dies June 2026 after the RBD, RMD 15,000, 5,000 taken: the
  // beneficiary takes 10,000 in 2026 (spec FD-3).
  it.todo(`ret/R32: blocked on ${FIRST_DEATH}`);
  // Q12: the 2027 QCD limit isn't published; Ledgr grows 2026's. No
  // figure until the notice posts (don't estimate).
  it.todo(
    'ret/Q12: blocked on [tax-data] "2027 tax data" (the 2027 QCD limit, when its notice posts)',
  );
});
