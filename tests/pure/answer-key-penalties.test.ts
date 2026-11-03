/**
 * Answer key, retirement: early-withdrawal additional tax, Rule of 55, the
 * 59½ and HSA 65 gates, and Roth ordering (`.scratch/docs/drafts/
 * answer-key.md` § Retirement rules; rulings in `reviews/2026-11-01/
 * rebuild/retirement-verdicts.md`, rules and worked cases in
 * `reviews/2026-11-01/specs/retirement-rules.md` § 7 and § 14.5). Ids are
 * the spec's own, prefixed `ret/` (the same letters repeat in other
 * areas); the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the rule, never read from `src/`:
 * IRC 72(t)(1) (10% of the part included in income), 72(t)(2)(A)(i) (59½),
 * 72(t)(2)(A)(v) and Pub 575 (2025) p.28 (Rule of 55: separation in or
 * after the year of 55), 72(t)(3)(A) (not for an IRA); IRC 223(f)(2),
 * (f)(4) and Pub 969 (2025) p.10 (HSA: income, plus 20% before 65); IRC
 * 408A(d)(3)(F), (d)(4)(B), Treas. Reg. 1.408A-6 A-5, A-8 and Pub 590-B
 * (2025) pp.33-36 (Roth ordering: regular contributions, then conversions
 * first in first out, then earnings; each conversion's 5-year clock);
 * Pub 590-B p.25 and Reg. 1.408-8(c)(3) (a spouse who treats an
 * inherited IRA as their own takes on the age test).
 *
 * The chain under test is the engine's: `computeWithdrawalEligibility`
 * (which dollars of an account are penalty-free this year) feeding
 * `computeEarlyWithdrawalPenalty` (the additional tax on what was drawn
 * beyond them); for a Roth IRA, `drawFromBasis` feeding
 * `splitRothWithdrawalForTax` gives the part that is income. A plan year
 * judges age as `year − birthYear` (spec PEN-3: a year model, until v0.11
 * "59½ tested by year"), so a case's date only enters through its year.
 *
 * Not written here (one header for the closed cases of the bulk group,
 * v0.11 Retirement rules "Answer key, retirement bulk group"):
 * - E9, E10, E11 (72(t) series): closed, decision E3 discloses 72(t) and
 *   doesn't model it.
 * - E12 (SIMPLE 25% in the first two years; Ledgr has no SIMPLE type),
 *   P7, P8 (QCD deduction offset): closed, disclosed only, v0.12
 *   Retirement rules "Disclose always".
 * - E22, E23 (an HSA draw for medical costs, an HSA owner who is
 *   disabled): closed by decision, every HSA draw is projected as
 *   non-medical (RET-23).
 * Blocked with an item that unblocks them: the `it.todo`s at the end.
 */
import { describe, expect, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import {
  computeWithdrawalEligibility,
  type EligibilityAccountInput,
} from "@/lib/pure/withdrawal-eligibility";
import { computeEarlyWithdrawalPenalty } from "@/lib/pure/early-withdrawal-penalty";
import {
  isRuleOf55Eligible,
  resolveSeparationYear,
} from "@/lib/pure/early-access";
import {
  drawFromBasis,
  type RothBasisState,
} from "@/lib/pure/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/roth-distribution-tax";
import { getAccountTypeConfig } from "@/lib/config/account-types";
import type { RuleOf55Status } from "@/lib/pure/tax-bucket-analysis";

// ---------------------------------------------------------------------------
// Inputs: one invented owner, one account, one plan year
// ---------------------------------------------------------------------------

const indKey = (a: {
  name: string;
  category: string;
  taxType: string;
  ownerPersonId?: number;
}) => `${a.name}|${a.category}|${a.taxType}|${a.ownerPersonId ?? "joint"}`;

/** A balance far above any draw below, so the draw never empties the
 *  account (the penalty is on what's drawn, not on what's left). */
const BIG_BALANCE = 1_000_000;

/** One account's year: the additional tax on `take`, and the dollars of
 *  the account that were penalty-free. */
function yearDraw(opts: {
  account: EligibilityAccountInput;
  year: number;
  take: number;
  balance?: number;
  basis?: RothBasisState;
}): { penalty: number; penaltyFree: number } {
  const key = indKey(opts.account);
  const exposure = computeWithdrawalEligibility({
    year: opts.year,
    indAccts: [opts.account],
    indBal: new Map([[key, opts.balance ?? BIG_BALANCE]]),
    indKey,
    indBasis: opts.basis ? new Map([[key, opts.basis]]) : undefined,
  });
  const priced = computeEarlyWithdrawalPenalty({
    exposure,
    withdrawnByKey: new Map([[key, opts.take]]),
  });
  return {
    penalty: priced.penaltyCost,
    penaltyFree: exposure.byKey.get(key)!.penaltyFreeAmount,
  };
}

const owned = (
  category: EligibilityAccountInput["category"],
  taxType: string,
  ownerBirthYear: number,
  extra: Partial<EligibilityAccountInput> = {},
): EligibilityAccountInput => ({
  name: `${category} ${taxType}`,
  category,
  taxType,
  ownerPersonId: 1,
  ownerBirthYear,
  ...extra,
});

/** A Traditional IRA draw: no basis (Ledgr has no IRA basis input), so
 *  the whole draw is income and the additional tax is 10% of it. */
const iraPenalty = (birthYear: number, year: number, take: number) =>
  yearDraw({ account: owned("ira", "preTax", birthYear), year, take }).penalty;

/** A Traditional 401(k) whose owner left the plan's employer in
 *  `separatedOn` (a job end date already past by the draw). */
function plan401k(birthYear: number, separatedOn: string, drawOn: string) {
  const separation = resolveSeparationYear({
    explicitSeparationYear: null,
    linkedJobs: [{ endDate: new Date(separatedOn), isSpeculative: false }],
    currentDate: new Date(drawOn),
  });
  const ruleOf55: RuleOf55Status = {
    eligible: isRuleOf55Eligible(separation.year!, birthYear),
    separationYear: separation.year,
    source: separation.source,
    knownFutureSeparationYear: null,
  };
  return owned("401k", "preTax", birthYear, { ruleOf55 });
}

/** A Roth IRA year: what part of `take` is income, and its additional
 *  tax. The balance is the three layers and nothing else. */
function rothYear(opts: {
  birthYear: number;
  year: number;
  regular: number;
  conversions: number;
  latestConversionYear: number | null;
  earnings?: number;
  take: number;
}): { income: number; penalty: number } {
  const balance = opts.regular + opts.conversions + (opts.earnings ?? 0);
  const basis: RothBasisState = {
    contributionBasis: opts.regular,
    conversionBasis: opts.conversions,
    latestConversionYear: opts.latestConversionYear,
    sourceYear: opts.year,
    isSeeded: false,
    stale: false,
  };
  const account = owned("ira", "taxFree", opts.birthYear);
  const key = indKey(account);
  const { penalty } = yearDraw({
    account,
    year: opts.year,
    take: opts.take,
    balance,
    basis,
  });
  const draw = drawFromBasis({
    state: basis,
    orderingRule: getAccountTypeConfig("ira").rothOrderingRules!,
    balanceBeforeWithdrawal: balance,
    withdrawal: opts.take,
  });
  const split = splitRothWithdrawalForTax({
    accounts: [{ indKey: key, ownerBirthYear: opts.birthYear }],
    draws: new Map([[key, draw]]),
    year: opts.year,
  });
  return { income: split.taxableGrowth, penalty };
}

const NO_DATE_59_HALF =
  'v0.11 Retirement rules "59½ tested by year" (verdict N3; decision D12.4: split by month)';
const SKEPTIC_CONFIRMED =
  'v0.11 Retirement rules "Retirement rules the skeptic confirmed"';

// ---------------------------------------------------------------------------
// A. The 10% and the 59½ gate (IRC 72(t)(1), (t)(2)(A)(i))
// ---------------------------------------------------------------------------

describe("answer key: the 10% additional tax and 59½", () => {
  it("ret/P9 [RET-18] Tom, 35, 3,000 from an IRA, no basis: 300 (Pub 590-B p.29)", () => {
    // Born 1990, 2025: 35. All 3,000 is income (no basis), no exception:
    // 10% × 3,000 = 300 (IRC 72(t)(1)).
    cents(iraPenalty(1990, 2025, 3_000), 300);
  });

  // E1/E2 and the year-model pair (audit RT49): DOB 1967-05-10 reaches 59½
  // on 2026-11-10 (six months after the 59th birthday; the day itself is
  // UNSOURCED-1 in the spec). The plan year judges 2026 as age 59, so
  // every 2026 draw is charged and every 2027 draw is free.
  it("ret/E1 [RET-19] IRA 20,000 the day before 59½: 2,000", () => {
    // 2026-11-09 is before 59½: 10% × 20,000 = 2,000. Ledgr gets it by
    // the year model (2026 − 1967 = 59 < 59½), not by the date.
    cents(iraPenalty(1967, 2026, 20_000), 2_000);
  });

  it("ret/E1:60 [RET-19] same IRA owner the next year, at 60: 0 (year model, RT49)", () => {
    // 2027: 60 ≥ 59½ under any reading: 0. With E1 this pins the year the
    // gate opens: a gate moved a year either way fails one of the two.
    cents(iraPenalty(1967, 2027, 20_000), 0);
  });

  describe("ret/E2 [RET-19]", () => {
    // Same IRA, drawn on 2026-11-10, the day of 59½: exempt, 0 (IRC
    // 72(t)(2)(A)(i), "on or after the date"). The plan year can't see the
    // date and charges the whole 2026 year: 2,000 today.
    xfail({
      id: "ret/E2 [RET-19]",
      todo: NO_DATE_59_HALF,
      run: () => iraPenalty(1967, 2026, 20_000),
      expected: 0,
      today: 2_000,
    });
  });

  it("ret/D7 [RET-19] spouse, 55, treats an inherited IRA as own, takes 10,000: 1,000", () => {
    // Treating it as her own makes it her IRA, under her own age test
    // (Pub 590-B p.25; Reg. 1.408-8(c)(3); spec PEN-17): 55 in 2026 (born
    // 1971), no death exception: 10% × 10,000 = 1,000.
    cents(iraPenalty(1971, 2026, 10_000), 1_000);
  });
});

// ---------------------------------------------------------------------------
// B. Rule of 55 (IRC 72(t)(2)(A)(v), (t)(3)(A); Pub 575 p.28)
// ---------------------------------------------------------------------------

describe("answer key: Rule of 55", () => {
  it("ret/P13 [RET-20] George left at 49, draws in the year he is 55: no Rule of 55 (Pub 575 p.28)", () => {
    // Born 1970, separated 2019 (49): the separation is before the year of
    // 55, so the exception never applies (PEN-4), whatever his age when he
    // draws. 2025 (55): the 401(k) has no penalty-free dollars.
    expect(isRuleOf55Eligible(2019, 1970)).toBe(false);
    const george = plan401k(1970, "2019-06-30", "2025-06-01");
    expect(
      yearDraw({ account: george, year: 2025, take: 10_000 }).penaltyFree,
    ).toBe(0);
  });

  it("ret/E4 [RET-20] born 1971-12-15, separates March 2026, 401(k) 50,000 in April: 0", () => {
    // 2026 is the year he turns 55 (December 15); separation in that year
    // qualifies even though he is 54 on the day (PEN-4; the "age 54" test
    // would charge 5,000).
    cents(
      yearDraw({
        account: plan401k(1971, "2026-03-31", "2026-04-15"),
        year: 2026,
        take: 50_000,
      }).penalty,
      0,
    );
  });

  it("ret/E5 [RET-20] same, separated December 2025: 5,000", () => {
    // 2025 is the year of 54: too early, permanently (PEN-4). 10% × 50,000.
    cents(
      yearDraw({
        account: plan401k(1971, "2025-12-15", "2026-04-15"),
        year: 2026,
        take: 50_000,
      }).penalty,
      5_000,
    );
  });

  it("ret/E6 [RET-20] E4's 401(k) rolled to an IRA first: 5,000", () => {
    // Rule of 55 is for qualified plans only (IRC 72(t)(3)(A); PEN-5): the
    // same 50,000 from an IRA at 55 is charged 10% = 5,000.
    cents(iraPenalty(1971, 2026, 50_000), 5_000);
  });

  it("ret/E8 [RET-20] separates at 50, not public safety: 10%", () => {
    // Born 1976, separated 2026 (50): under 55 and no public-safety
    // exception (72(t)(10) needs a qualified public safety employee; PEN-7):
    // 10% × 10,000 = 1,000.
    cents(
      yearDraw({
        account: plan401k(1976, "2026-02-27", "2026-06-01"),
        year: 2026,
        take: 10_000,
      }).penalty,
      1_000,
    );
  });
});

// ---------------------------------------------------------------------------
// C. HSA at 64 and 65 (IRC 223(f)(2), (f)(4)(C); Pub 969 p.10; audit RT54)
// ---------------------------------------------------------------------------

describe("answer key: HSA non-medical draws at 64 and 65", () => {
  // Every HSA draw is projected as non-medical (RET-23): income at any age
  // (223(f)(2)), plus 20% before 65 (223(f)(4)(A), (C)). Only the
  // additional tax is asserted: no function returns the HSA draw's income
  // on its own (the engine taxes it through the distribution tax rates).
  it("ret/E20 [RET-22] HSA, 64, 10,000 non-medical: 2,000", () => {
    // Born 1962, 2026: 64 < 65. 20% × 10,000 = 2,000.
    cents(
      yearDraw({ account: owned("hsa", "hsa", 1962), year: 2026, take: 10_000 })
        .penalty,
      2_000,
    );
  });

  it("ret/E21 [RET-22] HSA at 65: 0", () => {
    // Born 1961, 2026: 65, attained (223(f)(4)(C)): no additional tax.
    // With E20 this pins the year the gate opens.
    cents(
      yearDraw({ account: owned("hsa", "hsa", 1961), year: 2026, take: 10_000 })
        .penalty,
      0,
    );
  });
});

// ---------------------------------------------------------------------------
// D. Roth IRA ordering and clocks (IRC 408A(d)(3)(F), (d)(4)(B);
//    Reg. 1.408A-6 A-5, A-8; Pub 590-B pp.33-36)
// ---------------------------------------------------------------------------

describe("answer key: Roth ordering and the conversion clocks", () => {
  // Order out (ROTH-1): regular contributions (never income, never
  // charged), then conversions first in first out (not income; charged 10%
  // within their 5 years under 59½, ROTH-7), then earnings (income and 10%
  // unless qualified or excepted, ROTH-10). A conversion's clock starts on
  // January 1 of its year and runs 5 taxable years (ROTH-6): a 2022
  // conversion is clear from January 1, 2027.
  it("ret/P10 [RET-21] Amelia, 60, takes 7,000: income 0 (Pub 590-B p.36)", () => {
    // 2025, born 1965. 5,000 regular, then 2,000 of the 2021 conversion
    // (80,000, of which 60,000 was taxed): no earnings reached, so no
    // income; over 59½, so no additional tax (ROTH-8).
    cents(
      rothYear({
        birthYear: 1965,
        year: 2025,
        regular: 5_000,
        conversions: 80_000,
        latestConversionYear: 2021,
        take: 7_000,
      }),
      { income: 0, penalty: 0 },
    );
  });

  it("ret/E13 [RET-21] 52, 2022 conversion in its clock: income 0, additional tax 1,500", () => {
    // 2026, born 1974. Regular 5,000; 2022 conversion 30,000, all taxed;
    // takes 20,000: 5,000 regular, then 15,000 of the conversion, still in
    // its clock (to 12/31/2026). Income 0; 10% × 15,000 = 1,500.
    cents(
      rothYear({
        birthYear: 1974,
        year: 2026,
        regular: 5_000,
        conversions: 30_000,
        latestConversionYear: 2022,
        take: 20_000,
      }),
      { income: 0, penalty: 1_500 },
    );
  });

  it("ret/E14 [RET-21] E13 a year later, clock over: 0", () => {
    // 2027 (53): the 2022 clock ended 12/31/2026. Income 0, no charge.
    cents(
      rothYear({
        birthYear: 1974,
        year: 2027,
        regular: 5_000,
        conversions: 30_000,
        latestConversionYear: 2022,
        take: 20_000,
      }),
      { income: 0, penalty: 0 },
    );
  });

  it("ret/E15 [RET-21] E13 at 60: 0", () => {
    // Born 1966, 2026: 60 ≥ 59½, so the conversion charge is gone
    // whatever the clock (ROTH-8). Income 0.
    cents(
      rothYear({
        birthYear: 1966,
        year: 2026,
        regular: 5_000,
        conversions: 30_000,
        latestConversionYear: 2022,
        take: 20_000,
      }),
      { income: 0, penalty: 0 },
    );
  });

  it("ret/E17 [RET-21] 52, ordering reaches earnings: income 3,000, additional tax 1,300", () => {
    // 2026, born 1974. Regular 5,000; 2024 conversion 10,000; earnings
    // 3,000; takes all 18,000: 5,000 free; 10,000 conversion in its clock,
    // charged; 3,000 earnings, income and charged. 10% × 13,000 = 1,300.
    cents(
      rothYear({
        birthYear: 1974,
        year: 2026,
        regular: 5_000,
        conversions: 10_000,
        latestConversionYear: 2024,
        earnings: 3_000,
        take: 18_000,
      }),
      { income: 3_000, penalty: 1_300 },
    );
  });

  it("ret/E24 [RET-21] Ishmael, 85,500 from a Roth in 2025: 0 by statute (Pub 590-B p.36 prints 1,000)", () => {
    // Regular 55,500; 2005 conversion 10,000; 2016 rollover from a plan
    // 20,000; first home 10,000. 85,500 = 55,500 + 30,000: no earnings, so
    // no income. Each conversion's clock (408A(d)(3)(F)(i)(II)) is long
    // over: 2005's ended 2009, 2016's 12/31/2020 (Form 5329 instructions
    // 2025: "converted or rolled over ... in 2021 through 2025"). So 0.
    // The Pub's worksheet charges 20,000 less the 10,000 first-home
    // exception, 1,000: its window ("2015 through 2025") didn't move with
    // the year (verdict question 4, DOC-2). Born 1975 (50 in 2025).
    cents(
      rothYear({
        birthYear: 1975,
        year: 2025,
        regular: 55_500,
        conversions: 30_000,
        latestConversionYear: 2016,
        take: 85_500,
      }),
      { income: 0, penalty: 0 },
    );
  });

  describe("ret/E18 [RET-21]", () => {
    // 62 in 2026 (born 1964); first Roth 2024, so the five-year qualifying
    // clock (ROTH-4: 5 taxable years from January 1 of the first Roth
    // year) runs to 12/31/2028. Regular 7,000, earnings 3,000, takes all
    // 10,000: 7,000 free; 3,000 earnings in a non-qualified distribution
    // are income (ROTH-10), but 59½ is met, so no additional tax. Today
    // `isQualifiedRothOwner` reads age alone: income 0 (verdict K-F).
    xfail({
      id: "ret/E18 [RET-21]",
      todo: `${SKEPTIC_CONFIRMED} (verdict K-F: no five-year qualifying clock)`,
      run: () =>
        rothYear({
          birthYear: 1964,
          year: 2026,
          regular: 7_000,
          conversions: 0,
          latestConversionYear: null,
          earnings: 3_000,
          take: 10_000,
        }),
      expected: { income: 3_000, penalty: 0 },
      today: { income: 0, penalty: 0 },
    });
  });

  describe("ret/E19 [RET-21]", () => {
    // 52 in 2027 (born 1975). Conversions 10,000 in 2022 and 10,000 in
    // 2025, regular 0, takes 15,000. First in first out (ROTH-1): the
    // 2022 10,000 (clear from 1/1/2027) is free, then 5,000 of 2025's (in
    // its clock to 12/31/2029): 10% × 5,000 = 500. Today one clock from
    // the latest conversion (2025) locks both: 10% × 15,000 = 1,500
    // (verdict K-E; the pin at `tests/pure/early-access.test.ts:216`).
    xfail({
      id: "ret/E19 [RET-21]",
      todo: `${SKEPTIC_CONFIRMED} (verdict K-E: one conversion clock)`,
      run: () =>
        rothYear({
          birthYear: 1975,
          year: 2027,
          regular: 0,
          conversions: 20_000,
          latestConversionYear: 2025,
          take: 15_000,
        }),
      expected: { income: 0, penalty: 500 },
      today: { income: 0, penalty: 1_500 },
    });
  });
});

// ── Blocked, with an item that unblocks them ────────────────────────────

describe("answer key: retirement penalty cases blocked on a feature", () => {
  // Inputs and figures for each are in the answer key's Retirement rules.
  const IRA_BASIS = 'v0.11 Retirement rules "No IRA basis input"';
  // E3: IRA 20,000 at 45 with 25% basis pro rata: 1,500. P6: Amy's QCD
  // from an IRA of 30,000 with 10,000 basis (taxable first): 20,000.
  it.todo(`ret/E3: blocked on ${IRA_BASIS}`);
  it.todo(`ret/P6: blocked on ${IRA_BASIS}`);
  // E16: a 2023 conversion of 30,000 of which 10,000 was nontaxable, 52,
  // takes 25,000 in 2026: 2,000 (the taxable part first, ROTH-2; only it
  // is charged, 408A(d)(3)(F)(ii); verdict N6). Ledgr's Roth basis has no
  // field for a conversion's nontaxable part, which comes from IRA basis,
  // so the case has no input to carry it (checked on its first run, as
  // the plan asked).
  it.todo(`ret/E16: blocked on ${IRA_BASIS}`);

  // E25 (verdict N10): Single, 58 in 2034, Roth conversions of 119,100 a
  // year in 2026-2029, regular 0. Each conversion's clock has run by 2034
  // (ROTH-6), so 4 × 119,100 = 476,400 comes out free of tax and the 10%
  // (ROTH-1, ROTH-7). Counted as an expected failure, but nothing can be
  // called yet: no function adds a projected conversion to Roth basis
  // (`roth-basis-tracking.ts` is decrement-only; the fix adds one), and
  // 119,100 is the engine's own conversion size, not an input. So it's a
  // todo until the fix lands, as decided for A1/A21 (plan open question
  // 2). RULES § Known Gaps calls it "Roth conversions don't add to Roth
  // basis".
  it.todo(
    'ret/E25: blocked on v0.11 Retirement rules "Projected Roth conversions never enter basis" (verdict N10)',
  );

  // D1-D6: a spouse's death (filing status, inherited RMDs, the survivor's
  // benefit, the death exception); D7 above is the one that needs none.
  const FIRST_DEATH =
    'v0.11 Retirement rules "Add: survivor benefit and first death"';
  it.todo(`ret/D1: blocked on ${FIRST_DEATH}`);
  it.todo(`ret/D2: blocked on ${FIRST_DEATH}`);
  it.todo(`ret/D3: blocked on ${FIRST_DEATH}`);
  it.todo(`ret/D4: blocked on ${FIRST_DEATH}`);
  it.todo(`ret/D5: blocked on ${FIRST_DEATH}`);
  it.todo(`ret/D6: blocked on ${FIRST_DEATH}`);
});
