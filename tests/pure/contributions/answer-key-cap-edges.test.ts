/**
 * Answer key, the contribution and cap stage's edges no test reached
 * (the 2026-11-08 test-suite review § 3, survivors K1, K2, C2-C6; v0.10.5
 * overnight batch 3). Each expected figure is worked from its authority
 * first, never read from `src/`. Invented households only, 2026 limits
 * (IRA $7,500; HSA self-only $4,400) and 2025's for the prior year (IRA
 * $7,000).
 *
 * Citations: IRC 219(b)(1)(B) and 408A(c)(2) (an IRA, Traditional or
 * Roth, takes no more than the person's compensation) with 219(f)(1) and
 * Pub 590-A (2025) "What Is Compensation?" (taxable wages, Form W-2 box
 * 1: a bonus is in it, cafeteria-plan HSA money isn't, IRC 106(d), 125);
 * 223(b)(4)(B) (employer HSA money counts toward the HSA limit; 402(g)
 * counts deferrals only); 219(f)(3) (a contribution counts for the prior
 * year only when made for it by the due date). Owner design where it
 * decides (cited in the case): DESIGN § Household annual income and tax
 * (this year's bonus is the pinned one when set) for total compensation;
 * a bonus check's date is its month and day in the request's year.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { readTaxData } from "../../helpers/tax-data";
import { capEffectiveContribs } from "@/lib/pure/contributions/cap-pass";
import {
  computeSiblingTotal,
  resolvePriorYearLimit,
} from "@/lib/pure/contributions/irs-limits";
import {
  contributionAccountsFor,
  perContributionRows,
  personPay,
} from "@/lib/pure/contributions/person-snapshot";
import type { ContributionRow } from "@/lib/pure/contributions/contribution-rows";
import type { SalaryEntry } from "@/lib/db/shapes/salary-entry-defaults";

const limitsOf = (year: number): Record<string, number> =>
  Object.fromEntries(
    Object.entries(readTaxData().years[String(year)]!.limits).map(([k, v]) => [
      k,
      v.value,
    ]),
  );
const limits2026 = limitsOf(2026);
const limits2025 = limitsOf(2025);

let nextId = 1;
function row(
  over: Partial<ContributionRow> & { hsaCoverageType?: string | null },
): ContributionRow & { hsaCoverageType?: string | null } {
  return {
    id: nextId++,
    personId: 1,
    jobId: 10,
    accountType: "401k",
    subType: null,
    label: null,
    parentCategory: "Retirement",
    contributionMethod: "fixed_annual",
    contributionValue: "0",
    taxTreatment: "pre_tax",
    employerMatchType: null,
    employerMatchValue: null,
    employerMaxMatchPct: null,
    isPayrollDeducted: true,
    fromBonus: false,
    ...over,
  };
}

/** One Single person (born 1986), one biweekly job paying `salary` and
 *  `bonus` this year; the rows capped for 2026. */
function capped(salary: number, bonus: number, rows: ReturnType<typeof row>[]) {
  return capEffectiveContribs(rows, {
    activeJobs: [{ id: 10, personId: 1, payPeriod: "biweekly" }],
    jobSalaries: [
      {
        job: { id: 10, personId: 1 },
        salary,
        bonusGross: bonus,
        totalComp: salary + bonus,
      },
    ],
    people: [{ id: 1, birthYear: 1986 }],
    limits: limits2026,
    filingStatus: "Single",
    taxYear: 2026,
  });
}

const rothIra = (annual: number) =>
  row({
    jobId: null,
    accountType: "ira",
    taxTreatment: "tax_free",
    isPayrollDeducted: false,
    contributionValue: String(annual),
  });

describe("answer key: the IRA's compensation bound", () => {
  it("limits/LIM11-K1 [LIM-11] HSA payroll money isn't compensation", () => {
    // Pay $8,000, $2,000 of it to an HSA through payroll (§ 125, out of
    // box 1): compensation 6,000. A $7,500 Roth IRA is held to 6,000
    // (219(b)(1)(B), 408A(c)(2)).
    const out = capped(8_000, 0, [
      row({
        accountType: "hsa",
        taxTreatment: "hsa",
        hsaCoverageType: "self_only",
        contributionValue: "2000",
      }),
      rothIra(7_500),
    ]);
    cents(out[1]!.cap!.cappedAnnual, 6_000);
  });

  it("limits/LIM11-K2 [LIM-11] a bonus is compensation", () => {
    // Salary $5,000 and a $3,000 bonus: box 1 8,000. The $7,500 Roth IRA
    // fits whole (not held to the 5,000 salary).
    const out = capped(5_000, 3_000, [rothIra(7_500)]);
    cents(out[0]!.cap!.cappedAnnual, 7_500);
  });
});

describe("answer key: HSA employer money in the group total", () => {
  it("limits/LIM08-C5 [LIM-08] the other HSA row's match counts; a 401(k) match doesn't", () => {
    // Two HSA rows: A 2,000 with a 500 employer match, B 1,000. B's
    // others in the group: 2,000 + 500 = 2,500 (223(b)(4)(B)). A 401(k)
    // 5,000 with a 2,000 match beside a 403(b): the 403(b)'s others are
    // 5,000 (402(g) counts deferrals only).
    const hsa = [
      { accountType: "hsa", annualContribution: 2_000, employerMatch: 500 },
      { accountType: "hsa", annualContribution: 1_000, employerMatch: 0 },
    ];
    const plans = [
      { accountType: "401k", annualContribution: 5_000, employerMatch: 2_000 },
      { accountType: "403b", annualContribution: 3_000, employerMatch: 0 },
    ];
    cents(
      {
        hsa: computeSiblingTotal(hsa, 1, true),
        plans: computeSiblingTotal(plans, 1, false),
      },
      { hsa: 2_500, plans: 5_000 },
    );
  });
});

describe("answer key: prior-year amounts", () => {
  /** One IRA row (owner 45) with a prior-year amount tagged `year`, read
   *  inside the window for prior year 2025. */
  function priorYear(amount: number, year: number) {
    const raw = {
      id: 1,
      accountType: "ira",
      hsaCoverageType: null,
      priorYearContribAmount: String(amount),
      priorYearContribYear: year,
    };
    const { perContribData } = perContributionRows(
      [raw] as never,
      [{ annualContribution: 0, employerMatch: 0 }] as never,
      () => 7_500,
      true,
      2025,
      (type, coverage) => resolvePriorYearLimit(type, 45, coverage, limits2025),
      new Map(),
    );
    return perContribData[0]!.priorYear;
  }

  it("limits/LIM15-C3 [LIM-15] an amount tagged for another year doesn't count for this one", () => {
    // 3,000 tagged 2024, read for 2025's window: not a 2025 contribution
    // (219(f)(3)), so no prior-year figure at all.
    expect(priorYear(3_000, 2024)).toBeUndefined();
  });

  it("limits/LIM15-C4 [LIM-15] over the prior year's limit: no room left, never negative", () => {
    // 8,000 tagged 2025, owner 44 at the end of 2025: limit 7,000; room
    // 7,000 − 8,000 < 0, so 0.
    cents(
      {
        amount: priorYear(8_000, 2025)!.amount,
        limit: priorYear(8_000, 2025)!.limit,
        remaining: priorYear(8_000, 2025)!.remaining,
      },
      { amount: 8_000, limit: 7_000, remaining: 0 },
    );
  });
});

describe("answer key: this year's pay on the contribution summary", () => {
  it("limits/LIM22-C2 [LIM-22] a pinned bonus is this year's bonus in total compensation", () => {
    // Salary 100,000; bonus terms 10% × 1 × 12/12 = 10,000; this year's
    // bonus pinned at 15,000 (DESIGN § Household annual income and tax:
    // the set bonus if there is one). Total compensation 115,000; the
    // contribution pay's bonus 15,000.
    const entry = {
      salary: 100_000,
      bonusPercent: 0.1,
      bonusMultiplier: 1,
      monthsInBonusYear: 12,
      bonusOverride: 15_000,
    } as SalaryEntry;
    const p = personPay(new Map([[10, entry]]), { id: 10 }, new Map(), {
      id: 1,
    });
    cents(
      { total: p.totalCompensation, bonus: p.pay.bonusGross },
      { total: 115_000, bonus: 15_000 },
    );
  });

  it("limits/LIM22-C6 [LIM-22] the bonus check's date is its month and day in the year", () => {
    // Bonus month 3, day 15, figured on 2026-06-15: March 15, 2026. With
    // no day set: the 1st (March 1, 2026).
    const at = (day: number | null) =>
      contributionAccountsFor({
        effectiveContributions: [],
        activeJob: { id: 10, bonusMonth: 3, bonusDayOfMonth: day },
        person: { id: 1, dateOfBirth: "1986-05-01" },
        pay: { salary: 100_000, bonusGross: 10_000 },
        asOfDate: new Date("2026-06-15T12:00:00Z"),
        salary: 100_000,
        periodsPerYear: 26,
        limitsRecord: limits2026,
        totalCompensation: 110_000,
        age: 40,
        priorYearLimitsRecord: limits2025,
      })
        .bonusDate?.toISOString()
        .slice(0, 10);
    expect([at(15), at(null)]).toEqual(["2026-03-15", "2026-03-01"]);
  });
});
