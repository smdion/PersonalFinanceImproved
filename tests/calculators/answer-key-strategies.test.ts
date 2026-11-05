/**
 * Answer key, strategies: the nine spending strategies
 * (`.scratch/docs/drafts/answer-key.md` § Strategies; rulings in
 * `reviews/2026-11-01/rebuild/strategies-verdicts.md`, rules and worked
 * cases in `reviews/2026-11-01/specs/strategies.md` §§ 3–11 and § 15).
 * Ids are the spec's own, prefixed `strategies/`; the bracketed part is
 * the docs/CALCULATIONS.md row. Routing and the gross-up are in
 * `answer-key-routing.test.ts`.
 *
 * Every figure is worked by hand from the strategy's paper, never read
 * from `src/`:
 * - B94: Bengen, "Determining Withdrawal Rates Using Historical Data", JFP
 *   Oct 1994: a first-year amount "followed by inflation-adjusted
 *   withdrawals each succeeding year" (Fixed).
 * - G04: Guyton, "Decision Rules and Portfolio Management for Retirees",
 *   JFP Oct 2004, Rule 2: "no increase in withdrawals following a year in
 *   which the portfolio's total investment return is negative", no make-up
 *   (Forgo).
 * - GK06: Guyton & Klinger, "Decision Rules and Maximum Initial Withdrawal
 *   Rates", JFP Mar 2006: the freeze (p5: "negative and when that year's
 *   withdrawal rate would be greater than the initial withdrawal rate"),
 *   capital preservation (p7: rate "more than 20 percent above" the
 *   initial: cut 10%; off in the final 15 years), prosperity (p7-8: rate
 *   more than 20% below: raise 10%; no sunset), "more than" both ways.
 *   K07: Klinger, JFP Aug 2007, the worked CPR and prosperity examples.
 * - MS25: Morningstar, The State of Retirement Income 2025, Methods 1-8,
 *   pp. 20-24 (Spending Decline: real spending falls d a year; Constant
 *   Percentage with a floor at 90% of the first withdrawal, nominal;
 *   Endowment: p × the average of the last n balances, MS25 n = 10).
 * - P590: IRS Publication 590-B (2025) Appendix B Table III (Uniform
 *   Lifetime): 70 → 27.4 is not in it (it starts at 72); 72 → 27.4,
 *   73 → 26.5, 74 → 25.5, 75 → 24.6, 76 → 23.7, 80 → 20.2, 100 → 6.4,
 *   "120 and over" → 2.0. The RMD start age (IRC 401(a)(9)(C)(v), SECURE
 *   2.0 § 107): 73 for births 1951-1959, 75 from 1960.
 * - VG20: Jaconetti et al., From assets to income, Vanguard 2020, Figure
 *   A-1 (the dynamic spending rule, real domain, year-end flow): a
 *   percentage "of the prior year-end's real portfolio balance", held
 *   between "the previous year's real spending amount" +5% and −2.5%.
 *   VGUK: Vanguard, Sustainable spending rates in turbulent markets, Mar
 *   2021 (the 1,122,000 / 2% example). VGF: Vanguard, Fuel for the F.I.R.E.
 *   (−1.5% floor, zero inflation).
 * - FIN: finiki "Variable percentage withdrawal" (mirrors the Bogleheads
 *   table): pct = PMT(r, n) annuity-due = r ÷ [(1 − (1+r)^−n)(1+r)],
 *   r = s × 5.0% + (1 − s) × 1.9% real, n = 100 − age, the younger
 *   spouse's age; "It is suggested to limit the withdrawal percentage to no
 *   more than 10%."
 *
 * Owner rules the cases follow (DECISIONS § November review decisions,
 * § Open calls from the TODO refresh): the balance a strategy reads is the
 * prior year-end, start-of-year flow (OPEN-1, G1); Guardrails' rate is
 * (spending − Social Security) ÷ balance (G2); VPW keeps its 10% limit on
 * (G3, OPEN-5) and uses the formula unrounded (OPEN-6); Vanguard Dynamic's
 * bounds become real, as the paper does (G4); the Guardrails sunset
 * follows the Projection's final year (OPEN-4 there: "live while the year
 * is at least 15 years before the Projection's final year"). The spec's
 * own OPEN-4, "whose age VPW reads", is a different case with the same
 * name: `strategies/OPEN-4` below.
 *
 * Rule-level cases call the dispatcher (`applySpendingStrategy`) with the
 * strategy's key, so a swapped dispatch (audit mutants d02, d03) fails
 * them. Where a case runs several years at rule level, `ledger` carries
 * the year as the orchestrator does (`pre-year-setup.ts`): last year's
 * amount (raised by inflation for the strategies that use the raise),
 * last year's return, the strategy's own state, and the balance by the
 * case's flow. A case whose fix needs an input the strategy function
 * doesn't take (the Projection's end, a birth year) runs the real engine,
 * so the fixed code lands on the decided figure; engine figures are ±$1
 * (the engine rounds each year to the cent).
 *
 * Not written here (the verdict lists them as no answer-key case):
 * C01-C04 (Fixed paper sums: arithmetic of the inputs, not a strategy
 * rule), C06 (Forgo's Rule 1 against Rule 2: OPEN-8, decided Rule 2),
 * C09, C10 (variants Ledgr doesn't offer), C13, C14 (MS25's examples:
 * the paper's own figures disagree, OPEN-9; the full-rule answer is C17's
 * rule), C25, C28, C29, C41, C45, C60 (reference curves and variants),
 * C49 (the VPW table, already checked cell by cell in `vpw.test.ts`),
 * C54-C56 (Horan and CMR routing references).
 */
import { describe, expect, it } from "vitest";
import { cents, runOneYear, xfail } from "../fixtures/answer-key";
import {
  applySpendingStrategy,
  initialCrossYearState,
  type SpendingCrossYearState,
  type SpendingStrategyInput,
} from "@/lib/calculators/engine/spending-strategy";
import { calculateProjection } from "@/lib/calculators/engine";
import type { WithdrawalStrategyType } from "@/lib/config/withdrawal-strategies";
import type {
  EngineYearProjection,
  ProjectionInput,
} from "@/lib/pure/engine/types";
import type { IndividualAccountInput } from "@/lib/pure/types/shared";
import { acct, household } from "../pure/fixtures/two-person-household";

// ---------------------------------------------------------------------------
// Rule level: one call of the dispatcher
// ---------------------------------------------------------------------------

type Params = Record<string, number | boolean>;

/** One strategy year. `projectedExpenses` is what the orchestrator hands
 *  the strategy: last year's amount, already raised by inflation for the
 *  strategies that use the raise (Forgo, Guardrails). */
function input(
  o: Partial<Omit<SpendingStrategyInput, "crossYearState">> & {
    state?: Partial<SpendingCrossYearState>;
  },
): SpendingStrategyInput {
  const { state, ...rest } = o;
  return {
    projectedExpenses: 0,
    portfolioBalance: 0,
    effectiveInflation: 0,
    cpiInflation: 0,
    hasBudgetOverride: false,
    yearIndex: 1,
    age: 70,
    ssIncome: 0,
    ssIncomeToday: 0,
    ...rest,
    crossYearState: { ...initialCrossYearState(), ...state },
  };
}

const amount = (
  strategy: WithdrawalStrategyType,
  params: Params,
  i: SpendingStrategyInput,
) => applySpendingStrategy(strategy, params, i).projectedExpenses;

/** Strategies whose amount the orchestrator raises by inflation each year
 *  before the strategy sees it (`usesPostRetirementRaise`). */
const RAISED = new Set<WithdrawalStrategyType>([
  "fixed",
  "forgo_inflation_after_loss",
  "guyton_klinger",
]);

/**
 * Several years at rule level. Year 1 pays `first` (or what the strategy
 * sets from the balance); later years start from last year's amount.
 * Flow: `start` = withdraw, then grow ((B − w)(1 + R), the engine's,
 * OPEN-1); `end` = grow, then withdraw (B(1 + R) − w, VG20's).
 * `balances` replaces the flow with given year-start balances.
 */
function ledger(
  strategy: WithdrawalStrategyType,
  params: Params,
  o: {
    balance: number;
    first?: number;
    returns?: number[];
    balances?: number[];
    inflation: number;
    flow?: "start" | "end";
  },
): { w: number[]; end: number[] } {
  const years = o.balances?.length ?? o.returns!.length;
  const state: SpendingCrossYearState = initialCrossYearState();
  const w: number[] = [];
  const end: number[] = [];
  let B = o.balances?.[0] ?? o.balance;
  for (let t = 0; t < years; t++) {
    if (o.balances) B = o.balances[t]!;
    const prior = w[t - 1];
    const handed =
      t === 0
        ? (o.first ?? 0)
        : RAISED.has(strategy)
          ? prior! * (1 + o.inflation)
          : prior!;
    const r = applySpendingStrategy(strategy, params, {
      ...input({
        projectedExpenses: handed,
        portfolioBalance: B,
        effectiveInflation: o.inflation,
        cpiInflation: o.inflation,
        yearIndex: t,
      }),
      crossYearState: { ...state },
    });
    Object.assign(state, r.updatedState);
    const paid = r.projectedExpenses;
    w.push(paid);
    const R = o.returns?.[t] ?? 0;
    const next =
      (o.flow ?? "start") === "start"
        ? (B - paid) * (1 + R)
        : B * (1 + R) - paid;
    end.push(Math.round(next * 100) / 100);
    state.priorYearReturn = R;
    state.priorYearSpending = paid;
    state.decumulationYearCount++;
    B = next;
  }
  return { w, end };
}

/** Named figures from a list: `{ w1: …, w2: … }`. */
const named = (prefix: string, xs: number[]) =>
  Object.fromEntries(xs.map((x, i) => [`${prefix}${i + 1}`, x]));

// ---------------------------------------------------------------------------
// Engine level: one invented retiree, Roth money only (no tax), flat
// inflation, returns by age
// ---------------------------------------------------------------------------

const roth = (balance: number) =>
  acct("Roth IRA", "ira", balance, 1, "taxFree");

/** A single retiree born `birthYear`, retired from `startYear` (January 1,
 *  so the first year is a whole decumulation year), spending `spend` in
 *  the first year. `returns` maps an age to that year's return (the
 *  engine reads the closest age at or below). */
function retiree(o: {
  birthYear: number;
  startYear: number;
  endYear: number;
  accounts: IndividualAccountInput[];
  spend: number;
  inflation: number;
  returns: Record<number, number>;
  strategy: WithdrawalStrategyType;
  params?: Params;
  people?: number[];
  overrides?: Partial<ProjectionInput>;
}): ProjectionInput {
  const people = o.people ?? [o.birthYear];
  return household(
    o.accounts,
    {
      asOfDate: new Date(o.startYear, 0, 1),
      currentAge: o.startYear - o.birthYear,
      birthYear: o.birthYear,
      retirementYear: o.startYear,
      projectionEndYear: o.endYear,
      annualExpenses: o.spend,
      decumulationAnnualExpenses: o.spend,
      inflationRate: o.inflation,
      returnRates: Object.entries(o.returns).map(([age, rate]) => ({
        label: `Age ${age}`,
        rate,
      })),
      socialSecurityEntries: people.map((by, i) => ({
        personId: i + 1,
        personName: i === 0 ? "Ann" : "Bo",
        birthYear: by,
        startAge: 70,
        annualAmount: 0,
      })),
      perPersonBirthYears: people,
      filingStatus: people.length > 1 ? "MFJ" : "Single",
      ...o.overrides,
    },
    {
      withdrawalStrategy: o.strategy,
      strategyParams: o.params ? { [o.strategy]: o.params } : {},
      withdrawalOrder: ["ira", "brokerage", "401k", "403b", "hsa"],
      withdrawalSplits: { ira: 1, brokerage: 0, "401k": 0, "403b": 0, hsa: 0 },
    },
  );
}

/** The engine's yearly amounts (`projectedExpenses`) by year. */
function engineAmounts(i: ProjectionInput): Map<number, number> {
  return new Map(
    calculateProjection(i).projectionByYear.map((y) => [
      y.year,
      y.projectedExpenses,
    ]),
  );
}

const pick = (m: Map<number, number>, years: Record<string, number>) =>
  Object.fromEntries(
    Object.entries(years).map(([k, year]) => {
      const v = m.get(year);
      if (v === undefined) throw new Error(`no ${year} in the projection`);
      return [k, v];
    }),
  );

const ENGINE = 1; // ±$1 a row (answer key, Tolerance)

/** What a retirement year withdrew (an accumulation year throws). */
function withdrawn(y: EngineYearProjection): number {
  if (y.phase !== "decumulation") throw new Error(`${y.year} isn't retired`);
  return y.totalWithdrawal;
}

// The v0.11 items each expected failure waits on (todo/v0.11.x.md
// § Strategies, § Engine).
const GK06_RULES = `v0.11 Strategies "Guardrails isn't the published GK06 rule set"`;
const RAILS = `v0.11 Strategies "RMD Spending re-inflates a typed budget" (float noise on both rails)`;
const TYPED_YEAR = `v0.11 Strategies "RMD Spending re-inflates a typed budget"`;
const RMD_AGE = `v0.11 Strategies "RMD Spending starts at a hard-coded 72"`;
const DECLINE_CARRY = `v0.11 Strategies "RMD Spending starts at a hard-coded 72" (Spending Decline: carry last year's amount)`;
const REAL_BOUNDS = `v0.11 Strategies "Vanguard Dynamic: switch the ceiling and floor to real" (decision G4)`;

// ---------------------------------------------------------------------------
// Fixed real (spec § 3; B94)
// ---------------------------------------------------------------------------

describe("answer key: Fixed", () => {
  it("strategies/C05 [WDR-07] the depletion year pays what's left: 30,000 ×3, then 10,000", () => {
    // r 0, π 0, 100,000, target 30,000 (spec COM-5: never more than
    // there is). 100,000 → 70,000 → 40,000 → 10,000; year 4 pays 10,000
    // and 20,000 is unmet.
    const rows = calculateProjection(
      retiree({
        birthYear: 1956,
        startYear: 2026,
        endYear: 2031,
        accounts: [roth(100_000)],
        spend: 30_000,
        inflation: 0,
        returns: { 0: 0 },
        strategy: "fixed",
      }),
    ).projectionByYear;
    const paid = rows.slice(0, 4).map(withdrawn);
    cents(named("w", paid), {
      w1: 30_000,
      w2: 30_000,
      w3: 30_000,
      w4: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Forgo inflation after a loss (spec § 4; G04 Rule 2)
// ---------------------------------------------------------------------------

describe("answer key: Forgo inflation after a loss", () => {
  it("strategies/C07 [WDR-10] two losses, no make-up: 40,000; 40,000; 40,000; 41,200; 42,436", () => {
    // π 3%, 1,000,000, w1 40,000; returns −10%, −5%, +12%, +8%, 0%.
    // Year 2 follows a loss: frozen at 40,000; year 3 follows a loss:
    // 40,000; year 4 follows +12%: 40,000 × 1.03 = 41,200; year 5
    // follows +8%: 41,200 × 1.03 = 42,436. The missed raises are never
    // made up (G04: "There is no make-up").
    const { w } = ledger(
      "forgo_inflation_after_loss",
      {},
      {
        balance: 1_000_000,
        first: 40_000,
        returns: [-0.1, -0.05, 0.12, 0.08, 0],
        inflation: 0.03,
      },
    );
    cents(named("w", w), {
      w1: 40_000,
      w2: 40_000,
      w3: 40_000,
      w4: 41_200,
      w5: 42_436,
    });
  });

  it("strategies/C08 [WDR-10] a 0% return isn't a loss: 41,200", () => {
    // G04's "negative" is strict (spec FRG-3): w 40,000, R 0%, π 3% →
    // 40,000 × 1.03 = 41,200.
    const w = amount(
      "forgo_inflation_after_loss",
      {},
      input({
        projectedExpenses: 41_200,
        effectiveInflation: 0.03,
        cpiInflation: 0.03,
        state: {
          initialWithdrawalAmount: 40_000,
          priorYearReturn: 0,
          priorYearSpending: 40_000,
          decumulationYearCount: 1,
        },
      }),
    );
    cents(w, 41_200);
  });
});

// ---------------------------------------------------------------------------
// Guardrails (spec § 5; GK06, K07). Defaults are GK06's: exceeds 20%,
// cut 10%, fall 20%, raise 10%, the freeze on; params {} reads them.
// ---------------------------------------------------------------------------

/** A Guardrails year after the first: anchor `iwr`, last year `prior`,
 *  inflation `pi`, last year's return `R`, balance `B`. */
function gk(o: {
  iwr: number;
  prior: number;
  pi: number;
  R: number | null;
  B: number;
  age?: number;
}): number {
  return amount(
    "guyton_klinger",
    {},
    input({
      projectedExpenses: o.prior * (1 + o.pi),
      portfolioBalance: o.B,
      effectiveInflation: o.pi,
      cpiInflation: o.pi,
      age: o.age ?? 70,
      state: {
        initialWithdrawalRate: o.iwr,
        priorYearReturn: o.R,
        priorYearSpending: o.prior,
        priorYearSsIncome: 0,
        decumulationYearCount: 1,
      },
    }),
  );
}

describe("answer key: Guardrails", () => {
  it("strategies/C11 [WDR-08] capital preservation, Klinger 2007: 68,062.50", () => {
    // K07: B 1,250,000, scheduled 75,625, IWR 5%. 75,625 ÷ 1,250,000 =
    // 6.05% = 21% above 5% (> 20%) → cut 10%: 75,625 × 0.9 = 68,062.50
    // (K07 prints 68,062).
    const w = amount(
      "guyton_klinger",
      {},
      input({
        projectedExpenses: 75_625,
        portfolioBalance: 1_250_000,
        state: {
          initialWithdrawalRate: 0.05,
          priorYearReturn: 0.05,
          priorYearSsIncome: 0,
          decumulationYearCount: 1,
        },
      }),
    );
    cents(w, 68_062.5);
  });

  it("strategies/C12 [WDR-08] prosperity, Klinger 2007: 86,900", () => {
    // K07: B 2,000,000, scheduled 79,000, IWR 5%. 3.95% is 21% below 5%
    // (> 20%) → raise 10%: 79,000 × 1.1 = 86,900.
    const w = amount(
      "guyton_klinger",
      {},
      input({
        projectedExpenses: 79_000,
        portfolioBalance: 2_000_000,
        state: {
          initialWithdrawalRate: 0.05,
          priorYearReturn: 0.05,
          priorYearSsIncome: 0,
          decumulationYearCount: 1,
        },
      }),
    );
    cents(w, 86_900);
  });

  it("strategies/C15 [WDR-08] the upper rail is strict: 60,000", () => {
    // IWR 5%, candidate 60,000, B 1,000,000, prior return positive:
    // 6.00% is exactly 1.2 × 5%, not "more than" (GK06 p7) → no cut.
    cents(
      gk({ iwr: 0.05, prior: 60_000, pi: 0, R: 0.05, B: 1_000_000 }),
      60_000,
    );
  });

  xfail({
    id: "strategies/C16 [WDR-08]",
    todo: RAILS,
    // IWR 5%, candidate 40,000, B 1,000,000, π 0: 4.00% is exactly 0.8 ×
    // 5%, not "more than" 20% below (GK06 p7-8) → no raise: 40,000.
    // Today 0.05 × 0.8 = 0.04000000000000001 > 0.04 reads as below the
    // rail: 40,000 + 10% = 44,000 (verdict G3).
    run: () => gk({ iwr: 0.05, prior: 40_000, pi: 0, R: 0.05, B: 1_000_000 }),
    expected: 40_000,
    today: 44_000,
  });

  it("strategies/C17 [WDR-08] a loss year inside the band: freeze only, 50,000", () => {
    // IWR 5%, w 50,000, π 3%, R −8%, B 950,000. Candidate 51,500 ÷
    // 950,000 = 5.42% > 5% → freeze (GK06 p5); 50,000 ÷ 950,000 = 5.26%,
    // inside 4%-6% → 50,000.
    cents(
      gk({ iwr: 0.05, prior: 50_000, pi: 0.03, R: -0.08, B: 950_000 }),
      50_000,
    );
  });

  xfail({
    id: "strategies/C18 [WDR-08]",
    todo: GK06_RULES,
    // IWR 5%, w 50,000, π 3%, R −8%, B 1,100,000. Candidate 51,500 ÷
    // 1,100,000 = 4.68%, not above 5% → no freeze (GK06 p5 needs both
    // the loss and the rate above IWR); 4.68% is inside the rails →
    // 51,500. Today the freeze is unconditional: 50,000 (verdict G1).
    run: () =>
      gk({ iwr: 0.05, prior: 50_000, pi: 0.03, R: -0.08, B: 1_100_000 }),
    expected: 51_500,
    today: 50_000,
  });

  it("strategies/C19 [WDR-08] the frozen amount is tested, not the inflated one: 50,000", () => {
    // IWR 5%, w 50,000, π 6%, R −1%, B 840,000. Inflated 53,000 ÷
    // 840,000 = 6.31% would trip the 6% rail; the freeze comes first
    // (GK06 p7, "using the decision rules in effect"): 50,000 ÷ 840,000 =
    // 5.95% ≤ 6% → 50,000.
    cents(
      gk({ iwr: 0.05, prior: 50_000, pi: 0.06, R: -0.01, B: 840_000 }),
      50_000,
    );
  });

  it("strategies/C20 [WDR-08] in a gain year the cut sits on the inflated amount: 46,350", () => {
    // IWR 5%, w 50,000, π 3%, R +2%, B 800,000. 51,500 ÷ 800,000 =
    // 6.44% > 6% → 51,500 × 0.9 = 46,350.
    cents(
      gk({ iwr: 0.05, prior: 50_000, pi: 0.03, R: 0.02, B: 800_000 }),
      46_350,
    );
  });

  // C21, the sunset, through the engine: the rule (DECISIONS "Guardrails
  // sunset (OPEN-4)") is "live while the year is at least 15 years before
  // the Projection's final year", and the strategy function takes no
  // year or end today, so only an engine run lets the fix land. The key's
  // own figures (age 86, horizon 100, w 50,000, R +1%, B 700,000: 51,500;
  // at 85, 46,350) are the same rule at rule level; the engine can't reach
  // B 700,000 after a gain year from a 5% anchor, so this ledger reaches
  // the same test (a gain year, rate over the upper rail) in 2029:
  //   2026: B 1,000,000, w 50,000 (anchor 5%), R −30% → 665,000.
  //   2027: candidate 51,500 ÷ 665,000 = 7.74%, a loss → freeze 50,000;
  //         50,000 ÷ 665,000 = 7.52% > 6%, CPR live → 45,000.
  //         R +30% → (665,000 − 45,000) × 1.3 = 806,000.
  //   2028: 46,350 ÷ 806,000 = 5.75%, inside the rails → 46,350.
  //         R +1% → (806,000 − 46,350) × 1.01 = 767,246.50.
  //   2029: candidate 47,740.50 ÷ 767,246.50 = 6.22% > 6%, no loss; CPR
  //         off in the final 15 years → 47,740.50 (GK06 p7; MS25 p21).
  //         Today the cut fires: 47,740.50 × 0.9 = 42,966.45.
  // The Projection ends 2043 (`projectionEndYear`; the last row is 2042,
  // E7). Either reading of "final year" puts 2027 inside the live years
  // (≤ 2027 or ≤ 2028) and 2029 outside them, so the case doesn't turn
  // on E7's fix.
  xfail({
    id: "strategies/C21 [WDR-08]",
    todo: GK06_RULES,
    run: () =>
      pick(
        engineAmounts(
          retiree({
            birthYear: 1956,
            startYear: 2026,
            endYear: 2043,
            accounts: [roth(1_000_000)],
            spend: 50_000,
            inflation: 0.03,
            returns: { 70: -0.3, 71: 0.3, 72: 0.01, 73: 0 },
            strategy: "guyton_klinger",
          }),
        ),
        { live2027: 2027, inside2028: 2028, sunset2029: 2029 },
      ),
    expected: { live2027: 45_000, inside2028: 46_350, sunset2029: 47_740.5 },
    today: { live2027: 45_000, inside2028: 46_350, sunset2029: 42_966.45 },
    tolerance: ENGINE,
  });

  it("strategies/C22 [WDR-08] prosperity has no sunset: 56,650 at 95", () => {
    // Horizon 100, age 95, IWR 5%, w 50,000, π 3%, B 2,000,000.
    // 51,500 ÷ 2,000,000 = 2.58% < 4% → 51,500 × 1.1 = 56,650 (GK06
    // p7-8: only capital preservation stops in the last 15 years).
    cents(
      gk({
        iwr: 0.05,
        prior: 50_000,
        pi: 0.03,
        R: 0.05,
        B: 2_000_000,
        age: 95,
      }),
      56_650,
    );
  });

  it("strategies/C23 [WDR-08] seven-year ledger, retired 65, horizon 95", () => {
    // IWR 5%, π 3%, start-of-year flow; returns +20, −10, −25, +5, +30,
    // +30, +10%. CPR is live to 80, so throughout.
    //   1: 50,000 of 1,000,000 → 1,140,000.
    //   2: 51,500 ÷ 1,140,000 = 4.52% → 51,500 → 979,650.
    //   3: after −10%, 53,045 ÷ 979,650 = 5.41% > 5% → freeze 51,500;
    //      5.26% inside → 51,500 → 696,112.50.
    //   4: after −25%, freeze 51,500; 51,500 ÷ 696,112.50 = 7.40% > 6% →
    //      46,350 → 682,250.63.
    //   5: 47,740.50 ÷ 682,250.63 = 7.00% > 6% → 42,966.45 → 831,069.43.
    //   6: 44,255.44 ÷ 831,069.43 = 5.33% → 44,255.44.
    //   7: 45,583.11 ÷ 1,022,858 = 4.46% → 45,583.11.
    const { w } = ledger(
      "guyton_klinger",
      {},
      {
        balance: 1_000_000,
        first: 50_000,
        returns: [0.2, -0.1, -0.25, 0.05, 0.3, 0.3, 0.1],
        inflation: 0.03,
      },
    );
    cents(named("w", w), {
      w1: 50_000,
      w2: 51_500,
      w3: 51_500,
      w4: 46_350,
      w5: 42_966.45,
      w6: 44_255.44,
      w7: 45_583.11,
    });
  });

  it("strategies/C24 [WDR-08] consecutive cuts compound: 50,000; 45,000; 40,500; 37,543.50", () => {
    // Each cut is next year's base (GK06 p7-8). Returns −30, −20, +5, +5%:
    //   2: 51,500 ÷ 665,000 = 7.74%, loss → freeze 50,000; 7.52% → 45,000.
    //   3: 46,350 ÷ 496,000 = 9.34%, loss → freeze 45,000; 9.07% → 40,500.
    //   4: 41,715 ÷ 478,275 = 8.72%, no loss → 41,715 × 0.9 = 37,543.50.
    const { w } = ledger(
      "guyton_klinger",
      {},
      {
        balance: 1_000_000,
        first: 50_000,
        returns: [-0.3, -0.2, 0.05, 0.05],
        inflation: 0.03,
      },
    );
    cents(named("w", w), { w1: 50_000, w2: 45_000, w3: 40_500, w4: 37_543.5 });
  });
});

// ---------------------------------------------------------------------------
// Spending Decline (spec § 6; MS25 p22)
// ---------------------------------------------------------------------------

describe("answer key: Spending Decline", () => {
  it("strategies/C26 [WDR-12] the decline compounds with inflation: × 1.03 × 0.98", () => {
    // d 2%, π 3%, w1 60,000: w_t = w_(t−1) × 1.03 × 0.98 = × 1.0094
    // (MS25: real spending falls 2% a year), not × 1.01: 60,000; 60,564;
    // 61,133.30; 61,707.95; 62,288.01; 62,873.52. ±$0.02: the closed form
    // from year 1 and the carried form (N2's fix) differ by a cent from
    // year 5 (spec COM-9 allows $1).
    const { w } = ledger(
      "spending_decline",
      { annualDeclineRate: 0.02 },
      {
        balance: 1_000_000,
        first: 60_000,
        returns: [0, 0, 0, 0, 0, 0],
        inflation: 0.03,
      },
    );
    cents(
      named("w", w),
      {
        w1: 60_000,
        w2: 60_564,
        w3: 61_133.3,
        w4: 61_707.95,
        w5: 62_288.01,
        w6: 62_873.52,
      },
      0.02,
    );
  });

  it("strategies/C27 [WDR-12] d 0 is Fixed, and year 1 isn't cut: 60,000; 61,800; 63,654", () => {
    // 60,000 × 1.03 = 61,800; × 1.03 = 63,654 (spec SPD-2, SPD-5).
    const { w } = ledger(
      "spending_decline",
      { annualDeclineRate: 0 },
      {
        balance: 1_000_000,
        first: 60_000,
        returns: [0, 0, 0],
        inflation: 0.03,
      },
    );
    cents(named("w", w), { w1: 60_000, w2: 61_800, w3: 63_654 });
  });

  // N2: the real engine, Single born 1960, retired 2026 at 66, Retirement
  // budget 80,000, π 3%, 5% returns, d 2%; a quarter of the budget ends in
  // 2028 (a loan paid off: `expenseEndings`). The strategy is
  // `incomeSource: "budget"` and endings work "on a reactive strategy's
  // carried amount" (`expense-endings.ts`): 2027 80,000 × 1.0094 =
  // 80,752; 2028 80,752 × 0.75 × 1.0094 = 61,133.30 (= 80,000 × 1.0094² ×
  // 0.75). Today the ending changes nothing: 80,000 × 1.0094² = 81,511.07
  // (`spending-decline.ts:44-49` rebuilds from the first amount).
  xfail({
    id: "strategies/N2 [WDR-12]",
    todo: DECLINE_CARRY,
    run: () =>
      pick(
        engineAmounts(
          retiree({
            birthYear: 1960,
            startYear: 2026,
            endYear: 2030,
            accounts: [roth(5_000_000)],
            spend: 80_000,
            inflation: 0.03,
            returns: { 0: 0.05 },
            strategy: "spending_decline",
            params: { annualDeclineRate: 0.02 },
            overrides: {
              expenseEndings: [
                { year: 2028, accumulation: 0, decumulation: 0.25 },
              ],
            },
          }),
        ),
        { y2027: 2027, y2028: 2028 },
      ),
    expected: { y2027: 80_752, y2028: 61_133.3 },
    today: { y2027: 80_752, y2028: 81_511.07 },
    tolerance: ENGINE,
  });
});

// ---------------------------------------------------------------------------
// RMD Spending (spec § 7; MS25 Method 2, P590 Table III; owner rule:
// Fixed real before the RMD age, CPI-real)
// ---------------------------------------------------------------------------

/** RMD Spending at `age` on balance `B`, a later year (count ≥ 1). */
function rmdSpend(o: {
  age: number;
  B: number;
  prior?: number;
  cpi?: number;
  raise?: number;
}): number {
  return amount(
    "rmd_spending",
    { rmdMultiplier: 1 },
    input({
      projectedExpenses: o.prior ?? 0,
      portfolioBalance: o.B,
      effectiveInflation: o.raise ?? o.cpi ?? 0,
      cpiInflation: o.cpi ?? 0,
      age: o.age,
      primaryPersonAge: o.age,
      state: { decumulationYearCount: 1 },
    }),
  );
}

describe("answer key: RMD Spending", () => {
  it("strategies/C30a [WDR-11] from the RMD age, balance ÷ Table III", () => {
    // C30: RMD age 73, 2,000,000 at 70, first year 70,000, π 3%, r 5%,
    // SOY. Before 73: 70,000; 72,100; 74,263 (Fixed real), so the balance
    // at 73 is ((2,000,000 − 70,000) × 1.05 − 72,100) × 1.05 − 74,263) ×
    // 1.05 = 2,076,749.85. From 73, w = B ÷ D (P590 Table III), then
    // B' = (B − w) × 1.05:
    //   73: 2,076,749.85 ÷ 26.5 = 78,367.92
    //   74: 2,098,301.03 ÷ 25.5 = 82,286.31
    //   75: 2,116,815.46 ÷ 24.6 = 86,049.41
    //   76: 2,132,304.35 ÷ 23.7 = 89,970.65
    let B = 2_076_749.85;
    const got: Record<string, number> = {};
    for (const age of [73, 74, 75, 76]) {
      const w = rmdSpend({ age, B });
      got[`a${age}`] = w;
      B = Math.round((B - w) * 1.05 * 100) / 100;
    }
    cents(got, {
      a73: 78_367.92,
      a74: 82_286.31,
      a75: 86_049.41,
      a76: 89_970.65,
    });
  });

  it("strategies/C30:71 [WDR-11] before the RMD age it steps by CPI: 72,100", () => {
    // RMD-4: Fixed real from w1, by CPI. 70,000 × 1.03 = 72,100 at 71
    // (no Table III divisor below 72 either way).
    cents(
      rmdSpend({ age: 71, B: 2_026_500, prior: 70_000, cpi: 0.03 }),
      72_100,
    );
  });

  it("strategies/RMD-4 [WDR-11] the pre-RMD step is CPI, not the raise: 41,600", () => {
    // Spec RMD-4 (strategies report G9): raise 1%, CPI 4%, w1 40,000:
    // 40,000 × 1.04 = 41,600, where Fixed (by the raise) gives 40,400.
    // Fails if the raise skips the CPI step before the RMD age.
    cents(
      rmdSpend({
        age: 66,
        B: 1_000_000,
        prior: 40_000,
        cpi: 0.04,
        raise: 0.01,
      }),
      41_600,
    );
  });

  // C30b and RMD-1960 through the engine: the fix reads the cohort's
  // start age (`ctx.rmdStartAge`, from the birth year), which the
  // strategy function isn't given. Single, Roth 2,000,000, retired at 70
  // on 70,000, π 3%, 5% returns.
  xfail({
    id: "strategies/C30b [WDR-11]",
    todo: RMD_AGE,
    // Born 1956: RMD age 73 (SECURE 2.0 § 107). 2026 (70) 70,000 →
    // 2,026,500; 2027 (71) 72,100 → 2,052,120; 2028 (72) is before the
    // RMD age: 72,100 × 1.03 = 74,263.00 (RULES 615 "before the RMD age";
    // spec RMD-5). Today the divisor starts at 72: 2,052,120 ÷ 27.4 =
    // 74,894.89 (verdict G4).
    run: () =>
      pick(
        engineAmounts(
          retiree({
            birthYear: 1956,
            startYear: 2026,
            endYear: 2030,
            accounts: [roth(2_000_000)],
            spend: 70_000,
            inflation: 0.03,
            returns: { 0: 0.05 },
            strategy: "rmd_spending",
          }),
        ),
        { a71: 2027, a72: 2028 },
      ),
    expected: { a71: 72_100, a72: 74_263 },
    today: { a71: 72_100, a72: 74_894.89 },
    tolerance: ENGINE,
  });

  xfail({
    id: "strategies/RMD-1960 [WDR-11]",
    todo: RMD_AGE,
    // Born 1960: RMD age 75 (401(a)(9)(C)(v)(II)). As C30b from 2030:
    // Fixed real through 74 — 70,000; 72,100; 74,263; 76,490.89;
    // 78,785.62 — and the divisor from 75: balance 2,122,560.60 (each
    // year (B − w) × 1.05 from 2,000,000) ÷ 24.6 = 86,282.95. Today it
    // switches at 72: 2,052,120 ÷ 27.4 = 74,894.89, then 26.5, 25.5, 24.6
    // on the lower balances: 75 gets 2,116,139.16 ÷ 24.6 = 86,021.92.
    run: () =>
      pick(
        engineAmounts(
          retiree({
            birthYear: 1960,
            startYear: 2030,
            endYear: 2036,
            accounts: [roth(2_000_000)],
            spend: 70_000,
            inflation: 0.03,
            returns: { 0: 0.05 },
            strategy: "rmd_spending",
          }),
        ),
        { a72: 2032, a74: 2034, a75: 2035 },
      ),
    expected: { a72: 74_263, a74: 78_785.62, a75: 86_282.95 },
    today: { a72: 74_894.89, a74: 82_260.03, a75: 86_021.92 },
    tolerance: ENGINE,
  });

  // N1: the real engine, Single born 1960, retired 2026 at 66 (RMD age
  // 75, so 2028 is in the pre-RMD phase), budget 80,000, π 3%; 2028 set
  // to 50,000 a month. A figure typed for a year "is what it says"
  // (`expense-endings.ts:8`): 600,000, as Fixed and Forgo give. Today
  // RMD Spending raises it by CPI: 618,000 (verdict N1,
  // `rmd-spending.ts:34-35`). 2028 must be a later retirement year: as
  // the first one the engine pays 600,000 and the case can't fail.
  xfail({
    id: "strategies/N1 [WDR-11]",
    todo: TYPED_YEAR,
    run: () =>
      pick(
        engineAmounts(
          retiree({
            birthYear: 1960,
            startYear: 2026,
            endYear: 2030,
            accounts: [roth(5_000_000)],
            spend: 80_000,
            inflation: 0.03,
            returns: { 0: 0.05 },
            strategy: "rmd_spending",
            overrides: { budgetOverrides: [{ year: 2028, value: 50_000 }] },
          }),
        ),
        { y2027: 2027, y2028: 2028 },
      ),
    expected: { y2027: 82_400, y2028: 600_000 },
    today: { y2027: 82_400, y2028: 618_000 },
    tolerance: ENGINE,
  });

  it("strategies/C31 [WDR-11] Pub 590-B's example: 100,000 at 75 → 4,065.04", () => {
    // P590 (2025) p.8: 100,000 ÷ 24.6 = 4,065.04 (the Pub prints 4,065).
    cents(rmdSpend({ age: 75, B: 100_000 }), 4_065.04);
  });

  it("strategies/C32 [WDR-11] the table's ends: ÷ 6.4 at 100, ÷ 2.0 from 120", () => {
    // P590 Table III: 100 → 6.4, "120 and over" → 2.0. On 1,000,000:
    // 156,250 at 100; 500,000 at 120 and at 125.
    cents(
      {
        a100: rmdSpend({ age: 100, B: 1_000_000 }),
        a120: rmdSpend({ age: 120, B: 1_000_000 }),
        a125: rmdSpend({ age: 125, B: 1_000_000 }),
      },
      { a100: 156_250, a120: 500_000, a125: 500_000 },
    );
  });

  it("strategies/C33 [WDR-11] the whole retirement balance, not the Portfolio's: 49,504.95", () => {
    // Born 1946, 80 in 2026: Traditional 400,000, Roth 300,000,
    // Retirement brokerage 300,000, Portfolio-parented brokerage 500,000.
    // The strategy reads retirement money only (spec COM-1, RMD-6):
    // 1,000,000 ÷ 20.2 = 49,504.95. (The legal RMD, 400,000 ÷ 20.2 =
    // 19,801.98, runs separately.)
    const portfolio: IndividualAccountInput = {
      ...acct("Portfolio brokerage", "brokerage", 500_000, 1, "afterTax"),
      parentCategory: "Portfolio",
    };
    const row = runOneYear(
      retiree({
        birthYear: 1946,
        startYear: 2026,
        endYear: 2028,
        accounts: [
          acct("Traditional IRA", "ira", 400_000, 1, "preTax"),
          roth(300_000),
          acct("Brokerage", "brokerage", 300_000, 1, "afterTax"),
          portfolio,
        ],
        spend: 40_000,
        inflation: 0,
        returns: { 0: 0 },
        strategy: "rmd_spending",
      }),
      2026,
    );
    cents(row.projectedExpenses, 49_504.95);
  });
});

// ---------------------------------------------------------------------------
// Constant Percentage (spec § 8; MS25 Method 5, VG20)
// ---------------------------------------------------------------------------

describe("answer key: Constant Percentage", () => {
  const cp = (floorPercent: number) => ({
    withdrawalPercent: 0.04,
    floorPercent,
  });

  it("strategies/C34 [WDR-13] a floor at 90% of the first withdrawal: 40,000; 36,000; 36,000; 36,000", () => {
    // p 4%, SOY; returns −30, −20, +10, +40%. Balances 1,000,000;
    // 672,000; 508,800; 520,080. 4% gives 40,000; 26,880; 20,352;
    // 20,803.20; the floor 0.9 × 40,000 = 36,000 stays nominal (MS25:
    // "does not incorporate any type of inflation adjustment").
    const { w } = ledger("constant_percentage", cp(0.9), {
      balance: 1_000_000,
      returns: [-0.3, -0.2, 0.1, 0.4],
      inflation: 0.03,
    });
    cents(named("w", w), { w1: 40_000, w2: 36_000, w3: 36_000, w4: 36_000 });
  });

  it("strategies/C35 [WDR-13] no floor (VG20): 40,000; 26,880", () => {
    // F 0: 4% × 672,000 = 26,880.
    const { w } = ledger("constant_percentage", cp(0), {
      balance: 1_000_000,
      returns: [-0.3, 0.1],
      inflation: 0.03,
    });
    cents(named("w", w), { w1: 40_000, w2: 26_880 });
  });

  it("strategies/C36 [WDR-13] the floor is capped by the balance: 20,000", () => {
    // F 0.9, w1 40,000, then B 20,000: 4% is 800, the floor 36,000, and
    // only 20,000 is there (spec COM-5, CON-5). Through the engine, where
    // the cap lives: year 1 draws 40,000 of 1,000,000 and the return
    // leaves (1,000,000 − 40,000) × (20,000 ÷ 960,000) = 20,000.
    const rows = calculateProjection(
      retiree({
        birthYear: 1956,
        startYear: 2026,
        endYear: 2029,
        accounts: [roth(1_000_000)],
        spend: 40_000,
        inflation: 0,
        returns: { 70: 20_000 / 960_000 - 1, 71: 0 },
        strategy: "constant_percentage",
        params: cp(0.9),
      }),
    ).projectionByYear;
    cents(
      { w1: withdrawn(rows[0]!), w2: withdrawn(rows[1]!) },
      { w1: 40_000, w2: 20_000 },
      ENGINE,
    );
  });

  it("strategies/C37 [WDR-13] the floor doesn't inflate: 36,000 in year 21", () => {
    // w1 40,000, F 0.9, t 21, π 3% for 20 years: still 36,000, not
    // 36,000 × 1.03^20 = 65,020 (CON-3). B 100,000 so 4% (4,000) is under
    // the floor. Kills audit mutant c01.
    const w = amount(
      "constant_percentage",
      cp(0.9),
      input({
        portfolioBalance: 100_000,
        effectiveInflation: 0.03,
        cpiInflation: 0.03,
        yearIndex: 20,
        state: { initialWithdrawalAmount: 40_000, decumulationYearCount: 20 },
      }),
    );
    cents(w, 36_000);
  });
});

// ---------------------------------------------------------------------------
// Endowment (spec § 9; MS25 Method 6)
// ---------------------------------------------------------------------------

describe("answer key: Endowment", () => {
  it("strategies/C38 [WDR-14] window 3: builds up, then rolls", () => {
    // Year-start balances 1.0M, 1.1M, 0.9M, 0.95M, 1.2M; p 4%, F 0.9.
    //   1: 1,000,000 → 40,000
    //   2: (1.0 + 1.1) ÷ 2 = 1,050,000 → 42,000
    //   3: (1.0 + 1.1 + 0.9) ÷ 3 = 1,000,000 → 40,000
    //   4: (1.1 + 0.9 + 0.95) ÷ 3 = 983,333.33 → 39,333.33
    //   5: (0.9 + 0.95 + 1.2) ÷ 3 = 1,016,666.67 → 40,666.67
    // Through the dispatcher: Constant % (audit mutant d02) would give
    // 44,000 in year 2.
    const { w } = ledger(
      "endowment",
      { withdrawalPercent: 0.04, rollingYears: 3, floorPercent: 0.9 },
      {
        balance: 1_000_000,
        balances: [1_000_000, 1_100_000, 900_000, 950_000, 1_200_000],
        inflation: 0,
      },
    );
    cents(named("w", w), {
      w1: 40_000,
      w2: 42_000,
      w3: 40_000,
      w4: 39_333.33,
      w5: 40_666.67,
    });
  });

  it("strategies/C39 [WDR-14] MS25's 10-year window: the first value drops out in year 11", () => {
    // 1,000,000 rising 50,000 a year, p 4%. A_t is the mean of the last
    // min(10, t): t1 1,000,000 → 40,000; t2 1,025,000 → 41,000; t5
    // 1,100,000 → 44,000; t10 1,225,000 → 49,000; t11 (1.05M…1.5M)
    // 1,275,000 → 51,000; t12 1,325,000 → 53,000.
    const balances = Array.from(
      { length: 12 },
      (_, i) => 1_000_000 + 50_000 * i,
    );
    const { w } = ledger(
      "endowment",
      { withdrawalPercent: 0.04, rollingYears: 10, floorPercent: 0.9 },
      { balance: 1_000_000, balances, inflation: 0 },
    );
    cents(
      { t1: w[0]!, t2: w[1]!, t5: w[4]!, t10: w[9]!, t11: w[10]!, t12: w[11]! },
      {
        t1: 40_000,
        t2: 41_000,
        t5: 44_000,
        t10: 49_000,
        t11: 51_000,
        t12: 53_000,
      },
    );
  });

  it("strategies/C40 [WDR-14] the floor binds: 36,000 in year 3", () => {
    // Window 3, p 4%, F 0.9, w1 40,000; balances 1.0M, 0.6M, 0.5M:
    // A3 = 700,000 → 28,000 < 36,000 → 36,000.
    const { w } = ledger(
      "endowment",
      { withdrawalPercent: 0.04, rollingYears: 3, floorPercent: 0.9 },
      {
        balance: 1_000_000,
        balances: [1_000_000, 600_000, 500_000],
        inflation: 0,
      },
    );
    cents(w[2]!, 36_000);
  });
});

// ---------------------------------------------------------------------------
// Vanguard Dynamic (spec § 10; VG20 Figure A-1, VGUK, VGF). Decision G4:
// the ceiling and floor become real, as the paper does. In the paper's
// real domain s_t = clamp(p × E_(t−1) ÷ C_(t−1), s_(t−1)(1 − f),
// s_(t−1)(1 + c)) and w_t = s_t × C_t; in nominal dollars that is
// w_t = (1 + π_t) × clamp(p × B_t, w_(t−1)(1 − f), w_(t−1)(1 + c)), with
// B_t the prior year-end balance. Today's rule is the bracket alone.
// ---------------------------------------------------------------------------

const vd = (
  ceilingPercent: number,
  floorPercent: number,
  basePercent = 0.04,
) => ({
  basePercent,
  ceilingPercent,
  floorPercent,
});

/** One Vanguard year after the first. */
const vanguard = (o: {
  B: number;
  prior: number;
  pi: number;
  c?: number;
  f?: number;
  p?: number;
}) =>
  amount(
    "vanguard_dynamic",
    vd(o.c ?? 0.05, o.f ?? 0.025, o.p),
    input({
      portfolioBalance: o.B,
      effectiveInflation: o.pi,
      cpiInflation: o.pi,
      state: { priorYearSpending: o.prior, decumulationYearCount: 1 },
    }),
  );

describe("answer key: Vanguard Dynamic", () => {
  it("strategies/C46 [WDR-15] at π 0 both rules agree (VGF, −1.5% floor): 42,000 / 39,400", () => {
    // VGF: w1 40,000, ceiling +5% = 42,000, floor −1.5% = 39,400.
    // Case 1 value 1,056,000: 4% = 42,240 → 42,000. Case 2 864,000: 4% =
    // 34,560 → 39,400. With π 0 the real and nominal rules coincide.
    cents(
      {
        case1: vanguard({ B: 1_056_000, prior: 40_000, pi: 0, f: 0.015 }),
        case2: vanguard({ B: 864_000, prior: 40_000, pi: 0, f: 0.015 }),
      },
      { case1: 42_000, case2: 39_400 },
    );
  });

  xfail({
    id: "strategies/C42 [WDR-15]",
    todo: REAL_BOUNDS,
    // VG20 Figure A-1: 1,000,000, 4%, +5%/−2.5%, π 3%, year-end flow
    // (E_t = E_(t−1)(1 + R_t) − w_t). The figure's balances give R = 10%,
    // 5%, 5% (1,060,000 = 1,000,000 × 1.10 − 40,000; 1,069,740 + 43,260 =
    // 1,060,000 × 1.05; 1,079,154 + 44,073 = 1,069,740 × 1.05).
    //   1: 40,000 → 1,060,000.
    //   2: real 4% × 1,060,000 = 42,400, ceiling 40,000 × 1.05 = 42,000 →
    //      s 42,000; nominal × 1.03 = 43,260 → 1,069,740.
    //   3: real 4% × 1,069,740 ÷ 1.03 = 41,543.30, between 40,950 and
    //      44,100 → s 41,543.30; nominal × 1.0609 = 44,073.29 →
    //      1,079,153.71.
    // Today (nominal bounds, spec C43's table): 40,000; 42,000; 42,840;
    // ends 1,060,000; 1,071,000; 1,081,710.
    run: () => {
      const { w, end } = ledger("vanguard_dynamic", vd(0.05, 0.025), {
        balance: 1_000_000,
        returns: [0.1, 0.05, 0.05],
        inflation: 0.03,
        flow: "end",
      });
      return { ...named("w", w), ...named("end", end) };
    },
    expected: {
      w1: 40_000,
      w2: 43_260,
      w3: 44_073.29,
      end1: 1_060_000,
      end2: 1_069_740,
      end3: 1_079_153.71,
    },
    today: {
      w1: 40_000,
      w2: 42_000,
      w3: 42_840,
      end1: 1_060_000,
      end2: 1_071_000,
      end3: 1_081_710,
    },
    tolerance: 0.01,
  });

  xfail({
    id: "strategies/C43 [WDR-15]",
    todo: REAL_BOUNDS,
    // C42's year 2 alone: B 1,060,000, last year 40,000, π 3%. The
    // paper's rule: 1.03 × min(42,400, 42,000) = 43,260. Today's nominal
    // ceiling: 40,000 × 1.05 = 42,000.
    run: () => vanguard({ B: 1_060_000, prior: 40_000, pi: 0.03 }),
    expected: 43_260,
    today: 42_000,
  });

  xfail({
    id: "strategies/C44 [WDR-15]",
    todo: REAL_BOUNDS,
    // VGUK: 1,000,000 grows to 1,122,000 nominal with 2% inflation
    // (1,100,000 real); 5% → 55,000 real; ceiling on 50,000: 52,500 real
    // "before adding in inflation" → 52,500 × 1.02 = 53,550 nominal.
    // Today: 5% × 1,122,000 = 56,100, ceiling 50,000 × 1.05 = 52,500.
    run: () => vanguard({ B: 1_122_000, prior: 50_000, pi: 0.02, p: 0.05 }),
    expected: 53_550,
    today: 52_500,
  });

  // C47: the key has no paper-rule figure (only the owner-nominal table);
  // worked here from VG20's rule, VAN-3 to VAN-5. 1,000,000, 4%, π 3%,
  // SOY flow, returns −35%, −20%, +5%. The floor binds both years, so the
  // figure doesn't depend on which balance the percentage reads (the
  // prior year-end, or it deflated a year): the unconstrained amount is
  // under a fifth of the floor either way.
  //   1: 40,000; (1,000,000 − 40,000) × 0.65 = 624,000.
  //   2: real 4% × 624,000 = 24,960 (or 24,233 deflated) < floor 40,000 ×
  //      0.975 = 39,000 → s 39,000; nominal × 1.03 = 40,170.00;
  //      (624,000 − 40,170) × 0.8 = 467,064.
  //   3: real 4% × 467,064 ÷ 1.03 = 18,138 < floor 39,000 × 0.975 =
  //      38,025 → s 38,025; nominal × 1.0609 = 40,340.72;
  //      (467,064 − 40,340.72) × 1.05 = 448,059.44.
  // The floor falls 2.5% a year in real terms (40,000 × 1.00425²), not
  // 5.3% (spec VAN-10). Today (nominal floor, spec C47's table): 40,000;
  // 39,000; 38,025; ends 624,000; 468,000; 451,473.75.
  xfail({
    id: "strategies/C47 [WDR-15]",
    todo: REAL_BOUNDS,
    run: () => {
      const { w, end } = ledger("vanguard_dynamic", vd(0.05, 0.025), {
        balance: 1_000_000,
        returns: [-0.35, -0.2, 0.05],
        inflation: 0.03,
      });
      return { ...named("w", w), ...named("end", end) };
    },
    expected: {
      w1: 40_000,
      w2: 40_170,
      w3: 40_340.72,
      end1: 624_000,
      end2: 467_064,
      end3: 448_059.44,
    },
    today: {
      w1: 40_000,
      w2: 39_000,
      w3: 38_025,
      end1: 624_000,
      end2: 468_000,
      end3: 451_473.75,
    },
    tolerance: 0.01,
  });

  xfail({
    id: "strategies/C48 [WDR-15]",
    todo: REAL_BOUNDS,
    // c = f = 0: the paper rule holds real spending at s1, so w_t = w1 ×
    // C_t: 40,000; 41,200; 42,436 (Fixed; spec PROP-4). Today's nominal
    // rule freezes the dollars: 40,000 for ever. B 1,000,000 growing 10%
    // a year, so 4% of it is always above the bracket.
    run: () =>
      named(
        "w",
        ledger("vanguard_dynamic", vd(0, 0), {
          balance: 1_000_000,
          returns: [0.1, 0.1, 0.1],
          inflation: 0.03,
        }).w,
      ),
    expected: { w1: 40_000, w2: 41_200, w3: 42_436 },
    today: { w1: 40_000, w2: 40_000, w3: 40_000 },
  });
});

// ---------------------------------------------------------------------------
// VPW (spec § 11; FIN, the Bogleheads table)
// ---------------------------------------------------------------------------

const VPW: Params = {
  cap: 0.1,
  endAge: 100,
  stockReturn: 0.05,
  bondReturn: 0.019,
  stockShare: 0.6,
};

const vpw = (age: number, B: number, p: Params = {}) =>
  amount("vpw", { ...VPW, ...p }, input({ portfolioBalance: B, age }));

describe("answer key: VPW", () => {
  it("strategies/C50 [WDR-16] finiki's example: 65, 30% stocks, 1,200,000 → 4.4% (52,970.74 unrounded)", () => {
    // r = 0.3 × 5.0% + 0.7 × 1.9% = 2.83%, n = 35: PMT = 0.0283 ÷
    // [(1 − 1.0283^−35) × 1.0283] = 4.4142% — FIN's table prints 4.4%
    // (52,800). Ledgr uses the formula unrounded (OPEN-6, owner design):
    // 1,200,000 × 4.41423% = 52,970.74.
    const w = vpw(65, 1_200_000, { stockShare: 0.3 });
    expect(Math.round((w / 1_200_000) * 1000) / 10).toBe(4.4);
    cents(w, 52_970.74);
  });

  it("strategies/C51 [WDR-16] the last four years at the assumed return: level, ending at 0", () => {
    // 50/50: r = 3.45%, SOY, 96 with 300,000. PMT(n 4) = 26.286%,
    // (n 3) 34.470%, (n 2) 50.848%, (n 1) 100%: 78,857.82 each year,
    // since the balance earns exactly r (FIN: the table spends the
    // portfolio by 100). The table itself, so the limit is lifted (cap 1):
    // with decision G3's 10% (or the setting's 20% maximum) these years
    // pay 10% (20%) of the balance instead.
    let B = 300_000;
    const got: Record<string, number> = {};
    for (const age of [96, 97, 98, 99]) {
      const w = vpw(age, B, { stockShare: 0.5, cap: 1 });
      got[`a${age}`] = w;
      B = (B - w) * 1.0345;
    }
    // ±$0.02: each year's amount is rounded to the cent and the balance
    // carries it (the spec gives 78,858, ±$1).
    cents(
      got,
      { a96: 78_857.82, a97: 78_857.82, a98: 78_857.82, a99: 78_857.82 },
      0.02,
    );
    expect(Math.abs(B)).toBeLessThan(0.05);
  });

  it("strategies/C52 [WDR-16] a later last age is a younger row: 75 to 109 at 60/40 is n 35, 5.0%", () => {
    // r = 0.6 × 5.0% + 0.4 × 1.9% = 3.76%. Table run to 110 (last
    // withdrawal 109): n = 35, PMT 4.9966% ≈ 5.0% (FIN's 65 row at 60%);
    // to 100: n = 25, 6.0137% ≈ 6.0%. On 1,000,000: 49,966.08 and
    // 60,137.31.
    cents(
      {
        to110: vpw(75, 1_000_000, { endAge: 110 }),
        to100: vpw(75, 1_000_000),
      },
      { to110: 49_966.08, to100: 60_137.31 },
    );
  });

  it("strategies/C53 [WDR-16] the 10% limit (decision G3, on by default): 50,000; 57,969.32 without it", () => {
    // 90, 50/50, n 10: PMT(3.45%, 10) = 11.594% (FIN prints 11.6%). On
    // 500,000: 50,000 with the 10% limit (FIN: "suggested … no more than
    // 10%"; decision G3 keeps it on, overruling the spec's "default
    // unlimited"); 57,969.32 with the setting at its 20% maximum, which
    // doesn't bind here (the key's 58,000 is FIN's rounded 11.6%).
    cents(
      {
        limited: vpw(90, 500_000, { stockShare: 0.5 }),
        unlimited: vpw(90, 500_000, { stockShare: 0.5, cap: 0.2 }),
      },
      { limited: 50_000, unlimited: 57_969.32 },
    );
  });

  it("strategies/OPEN-4 [WDR-16] a couple's VPW reads the younger spouse, either way round: 96,115.29", () => {
    // FIN: "the younger spouse's" age. Couple 62 / 70, 2,000,000 Roth,
    // default 60% stocks (r 3.76%), first year: n = 100 − 62 = 38,
    // PMT = 4.80576% → 96,115.29, with the primary either the 62- or the
    // 70-year-old (verdict OPEN-4; spec VPW-6). The spec's OPEN-4 (whose
    // age a strategy reads), not DECISIONS' Guardrails sunset.
    const first = (people: number[]) =>
      runOneYear(
        retiree({
          birthYear: people[0]!,
          people,
          startYear: 2026,
          endYear: 2028,
          accounts: [roth(2_000_000)],
          spend: 80_000,
          inflation: 0,
          returns: { 0: 0 },
          strategy: "vpw",
          params: VPW,
        }),
        2026,
      ).projectedExpenses;
    cents(
      {
        youngerPrimary: first([1964, 1956]),
        olderPrimary: first([1956, 1964]),
      },
      { youngerPrimary: 96_115.29, olderPrimary: 96_115.29 },
    );
  });
});
