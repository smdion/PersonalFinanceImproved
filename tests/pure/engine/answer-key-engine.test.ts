/**
 * Answer key, engine single-year cases and the Retirement budget trace:
 * one projected year through `calculateProjection`, each figure worked by
 * hand from the published rules with its working beside it. Sources: the
 * November review's `rebuild/engine-verdicts.md` (E6, E7), `hand-worksheet.md`
 * (H5, H6) and `spending-terms-trace.md` (T2, T3), as collected in the draft
 * answer key (`.scratch/docs/drafts/answer-key.md` § Engine, Single-year and
 * regression cases, Retirement budget, and § "Re-run on `24bae33b`").
 *
 * Households are invented, written in the engine ledgers' input format and
 * mapped by `tests/fixtures/engine-ledgers/load.ts` (as-of 2026-01-01, a
 * whole year; shipped 2026 tables; Roth bracket target unset unless a case
 * says so). 2026 figures (Rev. Proc. 2025-32): standard deduction 16,100
 * Single, 32,200 MFJ (§ 4.14); 65+ add-on 2,050 unmarried, 1,650 married;
 * Single rates § 4.01 Table 3 (10% to 12,400, 12% to 50,400, 22% to
 * 105,700, 24% to 201,775, 32% to 256,225), MFJ Table 1 (10% to 24,800,
 * 12% to 100,800); gains 0% to 49,450 Single, 15% to 545,500 (§ 4.03).
 * Senior deduction 6,000 a person 65+, less 6% of MAGI over 75,000
 * (150,000 joint) (IRC 151(d)(5)(C); Schedule 1-A). Taxable Social
 * Security: Pub 915 Worksheet 1 (25,000/34,000 Single, 32,000/44,000 MFJ).
 * RMD divisors: Pub 590-B Table III (72: 27.4, 73: 26.5, 75: 24.6, 76:
 * 23.7). Withdrawal-sized figures are ±$1: the gross-up stops within a
 * cent of the need and the tax carries it (key § Re-run). An expected
 * failure's household sets the need to the key's W less the key's decided
 * tax, so the fixed code lands on the key's figures.
 *
 * Elsewhere, not copied here:
 * - E1 (the gross-up never draws the whole balance) and E1-prop (the
 *   gross-up's equation `W − cost(W) = need`, never over the need): pinned
 *   on v0.9.8 in `tests/pure/engine/gross-up-delivers-need.test.ts`
 *   (5f379577), on the fictional `fixtures/gross-up-whole-balance.ts`
 *   household. They replace the bounds-only check at
 *   `withdrawal-solver.test.ts:102-104`.
 * - S1, E8 (the server's spec-to-account match and cap pass), T4 and T6
 *   (the Retirement budget in the payload): `tests/server/services/projection/engine-payload/answer-key-payload.test.ts`.
 * - The ledgers H1–H7 and E3: `answer-key-ledgers.test.ts`.
 */
import { describe, it } from "vitest";
import { calculateProjection } from "@/lib/pure/engine";
import type {
  EngineDecumulationYear,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import { cents, runOneYear, xfail } from "../../fixtures/answer-key";
import {
  ledgerInput,
  type LedgerAccount,
  type LedgerHousehold,
  type LedgerInputOptions,
} from "../../fixtures/engine-ledgers/load";

/** Gross-up convergence, carried into the tax (see the header). */
const GROSS_UP = 1;

const SAME_YEAR_MAGI = `v0.11 Tax "Senior deduction must use same-year MAGI in every year"`;
const NIIT_UNFUNDED = `v0.11 Engine "NIIT unfunded when RMD money is reinvested"`;
const END_YEAR = `v0.11 Engine "Plan 'to 95' stops at 94" (D10: run the end year)`;
const BUDGET_CHANGES = `v0.11 Engine "Budget changes by year are in today's dollars" (decision: the engine inflates them; D12.11)`;
const BUDGET_LINE = `v0.11 Simulation "Success isn't comparable across strategies" (decision: the budget line grows with inflation for every strategy)`;

interface Person {
  id: "A" | "B";
  birthYear: number;
  /** Social Security a year, from `ssStartAge` (67 unless set). */
  ss?: number;
  ssStartAge?: number;
}

/** A retired household (no jobs) in the ledger input format. Accounts are
 *  Retirement-parented; the waterfall is the account order. */
function household(o: {
  status: "Single" | "MFJ";
  people: Person[];
  accounts: LedgerAccount[];
  spending: number;
  endYear: number;
  returnRate?: number;
  inflation?: number;
  routing?: "waterfall" | "bracket_filling";
  strategy?: string;
}): LedgerHousehold {
  return {
    filingStatus: o.status,
    inflation: String(o.inflation ?? 0),
    limitGrowth: "0",
    taxMultiplier: 1,
    spendingStrategy: o.strategy ?? "fixed",
    withdrawalRouting: o.routing ?? "waterfall",
    lumpSums: [],
    people: o.people.map((p, i) => ({
      id: p.id,
      primary: i === 0,
      birthDate: `${p.birthYear}-01-15`,
      ssAnnualToday: p.ss ?? 0,
      ssStartAge: p.ssStartAge ?? 67,
      jobs: [],
    })),
    accounts: o.accounts,
    contributions: [],
    returnRates: [{ fromAge: 0, rate: String(o.returnRate ?? 0) }],
    annualSpendingToday: o.spending,
    waterfall: o.accounts.map((a) => a.id),
    endYear: o.endYear,
  };
}

const ira = (
  owner: "A" | "B",
  balance: number,
  tax: "traditional" | "roth" = "traditional",
): LedgerAccount => ({
  id: `${owner}-ira-${tax}`,
  owner,
  category: "ira",
  tax,
  parent: "Retirement",
  balance,
});
const brokerage = (balance: number, basis: number): LedgerAccount => ({
  id: "A-brokerage",
  owner: "A",
  category: "brokerage",
  tax: "brokerage",
  parent: "Retirement",
  balance,
  basis,
});

function retired(
  h: LedgerHousehold,
  year: number,
  opts: LedgerInputOptions = {},
  patch?: (input: ProjectionInput) => void,
): EngineDecumulationYear {
  const input = ledgerInput(h, opts);
  patch?.(input);
  const r = runOneYear(input, year);
  if (r.phase !== "decumulation") throw new Error(`${year} isn't retired`);
  return r;
}

describe("answer key: a brokerage draw, all gains in the 0% band (hand worksheet H5)", () => {
  // Single, born 1974 (52 in 2026), no other income. Retirement brokerage
  // 2,000,000, basis 1,200,000: each dollar drawn is 0.4 gain (average
  // cost). 0% return and inflation; 2026. Taxable income = 0.4W − 16,100,
  // all gains, so the first 49,450 + 16,100 = 65,550 of gain is untaxed.
  const h5 = (spending: number) =>
    household({
      status: "Single",
      people: [{ id: "A", birthYear: 1974 }],
      accounts: [brokerage(2_000_000, 1_200_000)],
      spending,
      endYear: 2028,
    });
  const year = (spending: number) => () => {
    const r = retired(h5(spending), 2026);
    return { withdrawal: r.totalWithdrawal, tax: r.taxCost };
  };

  it("engine/HW-H5A [TAX-16] spend 80,000: no tax", () => {
    // Gains 0.4 × 80,000 = 32,000; TI 15,900 < 49,450: tax 0, W = 80,000.
    cents(year(80_000)(), { withdrawal: 80_000, tax: 0 }, GROSS_UP);
  });

  describe("engine/HW-H5B", () => {
    // Gains 56,000; TI 39,900 < 49,450: tax 0, W = 140,000. Today the
    // unused deduction never shelters gains: tax = 15% × (0.4W − 49,450),
    // W = 140,000 + 0.06W − 7,417.50 → W = 132,582.50 / 0.94 =
    // 141,045.21, tax 1,045.21.
    it("engine/HW-H5B [TAX-16]", () => {
      cents(year(140_000)(), { withdrawal: 140_000, tax: 0 }, GROSS_UP);
    });
  });

  describe("engine/HW-H5C", () => {
    // Into 15%: tax = 15% × (0.4W − 16,100 − 49,450) = 0.06W − 9,832.50;
    // W − tax = 400,000 → W = 390,167.50 / 0.94 = 415,071.81, tax
    // 15,071.81 (MAGI 166,028.72 < 200,000: no NIIT). Today, no deduction
    // against gains: tax = 0.06W − 7,417.50, W = 392,582.50 / 0.94 =
    // 417,640.96, tax 17,640.96.
    it("engine/HW-H5C [TAX-16]", () => {
      cents(
        year(400_000)(),
        { withdrawal: 415_071.81, tax: 15_071.81 },
        GROSS_UP,
      );
    });
  });
});

describe("answer key: RMDs and taxable Social Security (hand worksheet H6)", () => {
  // MFJ, retired. A born 1951 (75 in 2026), B born 1954 (72). A:
  // Traditional IRA 900,000, Roth IRA 100,000; B: Traditional IRA
  // 300,000; brokerage 200,000 (basis 200,000, so no gain). SS 38,000 (A)
  // and 20,000 (B), both claimed. Spending 80,000; 0% return and
  // inflation. Waterfall: brokerage, A's IRA, B's IRA, A's Roth.
  const h6 = household({
    status: "MFJ",
    people: [
      { id: "A", birthYear: 1951, ss: 38_000 },
      { id: "B", birthYear: 1954, ss: 20_000 },
    ],
    accounts: [
      brokerage(200_000, 200_000),
      ira("A", 900_000),
      ira("B", 300_000),
      ira("A", 100_000, "roth"),
    ],
    spending: 80_000,
    endYear: 2029,
  });

  it("engine/HW-H6-26 [RET-03] the 2026 RMD and taxable Social Security", () => {
    // A's RMD 900,000 / 24.6 = 36,585.37; B (72) has none (RMD age 73 for
    // births 1951–1959, IRC 401(a)(9)(C)(v)). The brokerage draw is basis
    // only, so other income is the RMD: provisional 36,585.37 + 29,000 =
    // 65,585.37; taxable SS = 0.85 × 21,585.37 + 6,000 = 24,347.56 (under
    // 0.85 × 58,000).
    const r = retired(h6, 2026);
    cents(
      { rmd: r.rmdAmount, taxableSS: r.taxableSS },
      { rmd: 36_585.37, taxableSS: 24_347.56 },
    );
  });

  describe("engine/HW-H6-26tax", () => {
    // AGI 36,585.37 + 24,347.56 = 60,932.93; deductions 32,200 + 2 × 1,650
    // + 2 × 6,000 senior (MAGI under 150,000) = 47,500; TI 13,432.93; tax
    // 10% = 1,343.29. Today (K1) no senior amount in the first retired
    // year: TI 25,432.93, tax 2,480 + 12% × 632.93 = 2,555.95 (engine
    // 2,555.96 on the unrounded RMD; ±$1).
    xfail({
      id: "engine/HW-H6-26tax [TAX-22]",
      todo: `${SAME_YEAR_MAGI} (K1: the year-1 senior deduction)`,
      run: () => retired(h6, 2026).taxCost,
      expected: 1_343.29,
      today: 2_555.96,
      tolerance: GROSS_UP,
    });
  });

  it("engine/HW-H6-27 [RET-03] the second year: both RMDs, taxable SS and tax", () => {
    // A (76): 863,414.63 (900,000 less 2026's RMD) / 23.7 = 36,431.00; B
    // (73): 300,000 / 26.5 = 11,320.75; total 47,751.75. Provisional
    // 47,751.75 + 29,000 = 76,751.75; taxable SS 0.85 × 32,751.75 + 6,000
    // = 33,838.99. AGI 81,590.74; deductions 47,500 (senior in full: MAGI
    // under 150,000); TI 34,090.74; tax 2,480 + 12% × 9,290.74 = 3,594.89.
    const r = retired(h6, 2027);
    const byPerson = Object.fromEntries(
      (r.rmdByPerson ?? []).map((p) => [p.personName, p.amount]),
    );
    cents(
      {
        rmdA: byPerson.A ?? NaN,
        rmdB: byPerson.B ?? NaN,
        rmd: r.rmdAmount,
        taxableSS: r.taxableSS,
        tax: r.taxCost,
      },
      {
        rmdA: 36_431,
        rmdB: 11_320.75,
        rmd: 47_751.75,
        taxableSS: 33_838.99,
        tax: 3_594.89,
      },
    );
  });

  describe("engine/HW-H6s", () => {
    // Single widow, born 1951 (75), Traditional IRA 500,000, SS 30,000,
    // spending 50,000 (need 20,000). RMD 500,000 / 24.6 = 20,325.20, the
    // whole draw: provisional 20,325.20 + 15,000 = 35,325.20; taxable SS
    // 0.85 × 1,325.20 + 4,500 = 5,626.42; AGI 25,951.62; deductions 16,100
    // + 2,050 + 6,000 senior = 24,150; TI 1,801.62; tax 180.16. The RMD
    // after tax (20,145.04) covers the need, so W stays the RMD. Today
    // (K1, no senior amount in year 1) the need grosses up past the RMD:
    // taxable SS 0.85W − 11,650, TI 1.85W − 29,800, tax 0.185W − 2,980;
    // 0.815W = 17,020 → W 20,883.44, tax 883.44.
    xfail({
      id: "engine/HW-H6s [TAX-22]",
      todo: `${SAME_YEAR_MAGI} (K1: the year-1 senior deduction)`,
      run: () => {
        const r = retired(
          household({
            status: "Single",
            people: [{ id: "A", birthYear: 1951, ss: 30_000 }],
            accounts: [ira("A", 500_000)],
            spending: 50_000,
            endYear: 2028,
          }),
          2026,
        );
        return {
          rmd: r.rmdAmount,
          withdrawal: r.totalWithdrawal,
          tax: r.taxCost,
        };
      },
      expected: { rmd: 20_325.2, withdrawal: 20_325.2, tax: 180.16 },
      today: { rmd: 20_325.2, withdrawal: 20_883.44, tax: 883.44 },
      tolerance: GROSS_UP,
    });
  });

  it.todo(
    `engine/HW-H6-pension: blocked on v0.11 Tax "No income beyond portfolio and SS" (no pension input; +24,000 taxable pension, tax 6,443.95)`,
  );
});

describe("answer key: NIIT funded before RMD money is reinvested (verdict E6)", () => {
  // Single, born 1950 (76), Retirement brokerage 2,000,000 (basis
  // 200,000: 0.9 of each dollar is gain), Traditional IRA 6,000,000;
  // spending 150,000; 5% return, 3% inflation (2026 is year 0: neither
  // moves its figures); the production 12% Roth bracket target, every
  // category in the draw order (waterfall alone draws 417,999.82). 2026,
  // both routing modes, each: RMD 6,000,000 / 23.7 = 253,164.56, plus
  // 100,867.06 from the brokerage (gain 90,780.35): W 354,031.62. Ordinary
  // TI 253,164.56 − 18,150 (no senior amount: MAGI 343,944.91) =
  // 235,014.56, tax 51,660.66; gains 15% × 90,780.35 = 13,617.05; NIIT
  // 3.8% × min(90,780.35, 343,944.91 − 200,000) = 3,449.65 (IRC 1411;
  // Form 8960); total 68,727.36. Decided: spend the full 150,000 and
  // reinvest what's left after all tax: 354,031.62 − 150,000 − 68,727.36
  // = 135,304.26, unmet 0. Today the NIIT isn't funded before the
  // reinvestment: spending 146,550.35 (short by exactly the NIIT),
  // reinvested 138,753.91, no unmet need shown. Key: W moved +$0.01 with
  // 5f379577, so ±$1.
  const e6 = (routing: "waterfall" | "bracket_filling") =>
    retired(
      household({
        status: "Single",
        people: [{ id: "A", birthYear: 1950 }],
        accounts: [brokerage(2_000_000, 200_000), ira("A", 6_000_000)],
        spending: 150_000,
        endYear: 2029,
        returnRate: 0.05,
        inflation: 0.03,
        routing,
      }),
      2026,
      { rothBracketTarget: 0.12, everyCategory: true },
    );

  describe("engine/E6", () => {
    xfail({
      id: "engine/E6 [TAX-20]",
      todo: NIIT_UNFUNDED,
      run: () => {
        const out: Record<string, number> = {};
        for (const mode of ["waterfall", "bracket_filling"] as const) {
          const r = e6(mode);
          out[`${mode}.spending`] = r.spending;
          out[`${mode}.niit`] = r.niitAmount;
          out[`${mode}.reinvested`] = r.rmdExcessAmount;
          out[`${mode}.unmet`] = r.unmetNeed ?? 0;
        }
        return out;
      },
      expected: {
        "waterfall.spending": 150_000,
        "waterfall.niit": 3_449.65,
        "waterfall.reinvested": 135_304.26,
        "waterfall.unmet": 0,
        "bracket_filling.spending": 150_000,
        "bracket_filling.niit": 3_449.65,
        "bracket_filling.reinvested": 135_304.26,
        "bracket_filling.unmet": 0,
      },
      today: {
        "waterfall.spending": 146_550.35,
        "waterfall.reinvested": 138_753.91,
        "bracket_filling.spending": 146_550.35,
        "bracket_filling.reinvested": 138_753.91,
      },
      tolerance: GROSS_UP,
    });
  });
});

describe("answer key: the plan's last year (verdict E7)", () => {
  // A plan "to 95" runs to the year its last person turns 95
  // (engine/ARCHITECTURE.md: "runs to the last person's end age"). Single,
  // born 1961, end age 95: projectionEndYear 2056 (birth year + end age,
  // as `householdTimeline` sets it). Rows 2026–2056 = 31, the last at 95.
  // Today the engine stops at 2055 (age 94): 30 rows.
  describe("engine/E7", () => {
    xfail({
      id: "engine/E7 [ENG-01]",
      todo: END_YEAR,
      run: () => {
        const rows = calculateProjection(
          ledgerInput(
            household({
              status: "Single",
              people: [{ id: "A", birthYear: 1961 }],
              accounts: [ira("A", 2_000_000, "roth")],
              spending: 50_000,
              endYear: 1961 + 95,
            }),
          ),
        ).projectionByYear;
        return { rows: rows.length, lastAge: rows.at(-1)!.age };
      },
      expected: { rows: 31, lastAge: 95 },
      today: { rows: 30, lastAge: 94 },
    });
  });
});

describe("answer key: the Retirement budget in the engine (spending-terms trace)", () => {
  // Single, born 1961, retired, Roth IRA only (no tax), 5% return, 3%
  // inflation, Retirement budget 90,000 a year from 2026. Year 20 is 2045:
  // 90,000 × 1.03^19 = 157,815.54.
  const t = (strategy = "fixed", roth = 3_000_000) =>
    household({
      status: "Single",
      people: [{ id: "A", birthYear: 1961 }],
      accounts: [ira("A", roth, "roth")],
      spending: 90_000,
      endYear: 2050,
      returnRate: 0.05,
      inflation: 0.03,
      strategy,
    });

  describe("engine/T2", () => {
    // Trace inconsistency #3: a Budget Change for 2045 picked from a
    // $7,500/month column is today's dollars (decision), so the engine
    // spends 7,500 × 12 × 1.03^19 = 157,815.54 in 2045. Today it applies
    // 90,000 as 2045's nominal dollars: a 43% real cut. (Roth 20,000,000,
    // so the money lasts.)
    xfail({
      id: "engine/T2 [ENG-09]",
      todo: BUDGET_CHANGES,
      run: () =>
        retired(t("fixed", 20_000_000), 2045, {}, (i) => {
          i.budgetOverrides = [{ year: 2045, value: 7_500 }];
        }).projectedExpenses,
      expected: 157_815.54,
      today: 90_000,
    });
  });

  describe("engine/T3", () => {
    // Trace inconsistency #4: the budget line (`budgetOnlyExpenses`) grows
    // with inflation for every strategy (decision), so it's 157,815.54 in
    // 2045 under each of the nine. Today it stays 90,000 for Spending
    // Decline and the five balance-based strategies
    // (`pre-year-setup.ts:345-373`). The Retirement budget is sent as
    // `decumulationAnnualExpenses` (key § Re-run).
    const strategies = [
      "fixed",
      "forgo_inflation_after_loss",
      "guyton_klinger",
      "spending_decline",
      "rmd_spending",
      "constant_percentage",
      "endowment",
      "vanguard_dynamic",
      "vpw",
    ];
    const flatToday = new Set(strategies.slice(3));
    xfail({
      id: "engine/T3 [ENG-09]",
      todo: BUDGET_LINE,
      run: () =>
        Object.fromEntries(
          strategies.map((s) => [
            s,
            retired(t(s), 2045, {}, (i) => {
              i.decumulationAnnualExpenses = 90_000;
            }).budgetOnlyExpenses,
          ]),
        ),
      expected: Object.fromEntries(strategies.map((s) => [s, 157_815.54])),
      today: Object.fromEntries(
        strategies.map((s) => [s, flatToday.has(s) ? 90_000 : 157_815.54]),
      ),
    });
  });
});
