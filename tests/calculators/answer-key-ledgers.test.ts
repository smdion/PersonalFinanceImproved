/**
 * Answer key, engine ledgers: households H1–H7 run year by year through
 * `calculateProjection` and checked against hand-style ledgers built blind
 * from the engine spec and the published tables, with no reference to
 * Ledgr code. Source: the November review's `specs/engine-ledgers/`
 * (README, `build_ledgers.py`, `households.py`, second check
 * `verify_ledgers.py`), as collected in the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Engine, Ledgers and hand checks,
 * and § "Re-run on `24bae33b`"). The files are copied into
 * `tests/fixtures/engine-ledgers/` with the generator beside them: every
 * ledger figure's derivation is `build_ledgers.py` on that household, and
 * `verify_ledgers.py` re-derives it from the CSVs and
 * `tax-data/us-federal/2026.json` (153 household-years, 0 problems).
 *
 * Inputs are invented households (`households.py`). They're fed straight
 * to the engine (`tests/fixtures/engine-ledgers/load.ts`) with the Roth
 * bracket target unset, which the README requires: the payload's default
 * 0.12 replaces a waterfall's order (engine verdict E2, v0.11 Engine
 * "`rothBracketTarget` null becomes 0.12").
 *
 * Tolerance (UD-25, D12.12): ±$1 a row on flows, and ±$1 for every row so
 * far on balances (`ledgerRow`).
 *
 * The ledgers follow three conditional rules the owner has since decided
 * differently, so they're today's regression, rebuilt (not read as bugs)
 * when the decision lands: C1 indexed tax figures grow unrounded (D12.9:
 * IRS rounding), C2 the annual-method gap-year take-home (D7: the person's
 * real paycheck net; H2 2028–2032), C3 limits grow unrounded (D12.2; H5).
 * C4 average cost matches D8.
 *
 * Each ledger includes its end year. The engine stops a year early (E7);
 * decision D10 runs the end year, so each ledger's last row is an
 * expected failure on D10 (`-end`, or named in the whole-ledger case).
 *
 * Blocked (it.todo): H1, H5 need decision D11's true fixed-dollar
 * contribution (today a "fixed amount" grows with limits, E9).
 */
import { describe, expect, it } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  EngineDecumulationYear,
  EngineYearProjection,
  ProjectionResult,
} from "@/lib/pure/engine/types";
import { ledgerRow, runOneYear, xfail } from "../fixtures/answer-key";
import {
  ledgerInput,
  money,
  readAccountRows,
  readHousehold,
  readLedger,
  rmdTotal,
  type LedgerHousehold,
  type LedgerInputOptions,
} from "../fixtures/engine-ledgers/load";

const END_YEAR = `v0.11 Engine "Plan 'to 95' stops at 94" (D10: run the end year)`;
const SAME_YEAR_MAGI = `v0.11 Tax "Senior deduction must use same-year MAGI in every year"`;
const GAP_YEARS = `v0.11 Engine "Gap years use the one solver and the one deduction function"`;
const ROTH_SPLIT_403B = `v0.11 Engine "Plan 'to 95' stops at 94" (its 403(b) part: "403(b) reads the 401(k)'s Roth split")`;

/** Flow columns of a ledger row the engine reports. */
const FLOWS = [
  "spending",
  "ret_contributions",
  "ret_growth",
  "all_contributions",
  "all_growth",
  "withdrawals",
  "tax",
  "penalty",
  "gross_distributions",
  "reinvested",
  "unmet_need",
  "rmd_required",
  "social_security",
] as const;
/** Balance columns: the allowance carries forward a dollar a row. */
const BALANCES = ["ret_end", "all_end"] as const;

/**
 * The engine's year in the ledger's columns. Retirement year: tax is the
 * income tax plus the penalty, reinvested is the RMD money beyond the need,
 * and an unmet need of 0 is reported as undefined. Gap year: the draw and
 * the tax it adds over the pay's (`gapDraw`). `withdrawals` is what's left
 * for spending (README: gross = withdrawals + tax + reinvested).
 */
function engineCells(
  y: EngineYearProjection,
  h: LedgerHousehold,
): Record<string, number> {
  const accounts = y.individualAccountBalances;
  const lump = h.lumpSums
    .filter((l) => l.year === y.year)
    .reduce((s, l) => s + l.amount, 0);
  const inflow = (a: (typeof accounts)[number]) =>
    a.contribution + a.employerMatch;
  const ret = accounts.filter((a) => a.parentCategory !== "Portfolio");
  const cells: Record<string, number> = {
    spending: y.projectedExpenses,
    ret_contributions: ret.reduce((s, a) => s + inflow(a), 0) + lump,
    all_contributions: accounts.reduce((s, a) => s + inflow(a), 0) + lump,
    ret_growth: ret.reduce((s, a) => s + a.growth, 0),
    all_growth: accounts.reduce((s, a) => s + a.growth, 0),
    ret_end: y.retirementBalance,
    all_end: y.allAccountsBalance,
  };
  if (y.phase === "decumulation") {
    cells.tax = y.taxCost + (y.penaltyCost ?? 0);
    cells.penalty = y.penaltyCost ?? 0;
    cells.gross_distributions = y.totalWithdrawal;
    cells.reinvested = y.rmdExcessAmount;
    cells.unmet_need = y.unmetNeed ?? 0;
    cells.rmd_required = y.rmdAmount;
    cells.social_security = y.ssIncome;
  } else {
    const g = y.gapDraw;
    cells.tax = g?.taxCost ?? 0;
    cells.penalty = 0;
    cells.gross_distributions = g?.withdrawal ?? 0;
    cells.reinvested = 0;
    cells.unmet_need = g?.unmetNeed ?? 0;
    cells.rmd_required = 0;
    cells.social_security = g?.ssIncome ?? 0;
  }
  cells.withdrawals = cells.gross_distributions! - cells.tax - cells.reinvested;
  // Each account: `<id>.end`, `.basis_end` (balances), `.contributions`,
  // `.match`, `.growth`, `.gross_distribution` (flows).
  for (const a of accounts) {
    cells[`${a.name}.end`] = a.balance;
    if (a.costBasis !== undefined) cells[`${a.name}.basis_end`] = a.costBasis;
    cells[`${a.name}.contributions`] = a.contribution;
    cells[`${a.name}.match`] = a.employerMatch;
    cells[`${a.name}.growth`] = a.growth;
    cells[`${a.name}.gross_distribution`] = a.withdrawal ?? 0;
  }
  return cells;
}

/** The ledger's year, the same columns, and which of them are balances. */
function ledgerCells(
  id: string,
): Map<number, { cells: Record<string, number>; balanceKeys: string[] }> {
  const byYear = new Map<
    number,
    { cells: Record<string, number>; balanceKeys: string[] }
  >();
  for (const r of readLedger(id)) {
    const cells: Record<string, number> = {};
    for (const k of [...FLOWS, ...BALANCES])
      cells[k] = k === "rmd_required" ? rmdTotal(r[k]) : money(r[k]);
    byYear.set(Number(r.year), { cells, balanceKeys: [...BALANCES] });
  }
  for (const r of readAccountRows(id)) {
    const row = byYear.get(Number(r.year))!;
    const a = r.account!;
    row.cells[`${a}.end`] = money(r.end);
    row.cells[`${a}.contributions`] = money(r.contributions);
    row.cells[`${a}.match`] = money(r.match);
    row.cells[`${a}.growth`] = money(r.growth);
    row.cells[`${a}.gross_distribution`] = money(r.gross_distribution);
    row.balanceKeys.push(`${a}.end`);
    if (r.basis_end !== "") {
      row.cells[`${a}.basis_end`] = money(r.basis_end);
      row.balanceKeys.push(`${a}.basis_end`);
    }
  }
  return byYear;
}

function project(id: string, opts: LedgerInputOptions = {}) {
  const h = readHousehold(id);
  return { h, result: calculateProjection(ledgerInput(h, opts)) };
}

/** Assert every ledger row in `years` (row 0 is the ledger's first). */
function expectLedger(
  id: string,
  years: { from: number; to: number },
  opts: LedgerInputOptions = {},
): void {
  const { h, result } = project(id, opts);
  const ledger = ledgerCells(id);
  const first = Math.min(...ledger.keys());
  for (let year = years.from; year <= years.to; year++) {
    const want = ledger.get(year)!;
    const got = result.projectionByYear.find((y) => y.year === year);
    expect(got, `${id} has no ${year} row`).toBeDefined();
    ledgerRow(engineCells(got!, h), want.cells, {
      row: year - first,
      balanceKeys: want.balanceKeys,
    });
  }
}

/** Ledger rows (end year included) with a cell outside the allowance, or
 *  missing; 0 when the ledger matches. */
function rowsOff(id: string, opts: LedgerInputOptions = {}): number {
  const { h, result } = project(id, opts);
  const ledger = ledgerCells(id);
  const first = Math.min(...ledger.keys());
  let off = 0;
  for (const [year, want] of ledger) {
    const got = result.projectionByYear.find((y) => y.year === year);
    if (!got) {
      off++;
      continue;
    }
    try {
      ledgerRow(engineCells(got, h), want.cells, {
        row: year - first,
        balanceKeys: want.balanceKeys,
      });
    } catch {
      off++;
    }
  }
  return off;
}

/** The year's retirement balance; NaN when the plan doesn't reach it. */
function endBalance(result: ProjectionResult, year: number): number {
  const row = result.projectionByYear.find((y) => y.year === year);
  return row ? row.retirementBalance : NaN;
}

function retired(id: string, year: number, opts: LedgerInputOptions = {}) {
  const r = runOneYear(ledgerInput(readHousehold(id), opts), year);
  if (r.phase !== "decumulation")
    throw new Error(`${id} ${year} isn't retired`);
  return r as EngineDecumulationYear;
}

describe("answer key: engine ledger H4 (early retiree on a Retirement brokerage)", () => {
  // Single, born 1978-01-15 (48), no job. Retirement brokerage 1,000,000
  // (basis 600,000), Traditional IRA 500,000, Roth IRA 100,000; 5%, 3%
  // inflation; spending 60,000; waterfall brokerage → IRA → Roth. Average
  // cost (C4, D8), gains at 0% while taxable income stays under the 0% top;
  // the brokerage empties in 2046, first RMD 2053 (born 1978: age 75).
  it("engine/H4 [ENG-01] every ledger row 2026–2053", () => {
    // Re-run on 24bae33b: matches to $0.03 with the bracket target unset.
    expectLedger("H4", { from: 2026, to: 2053 });
  });

  it("engine/H4-2026 [ENG-20] gains on a basis draw", () => {
    // Spec § 16. Draw 60,000 from the brokerage (spending, no other
    // income): the basis share is 600,000 / 1,000,000, so basis drawn
    // 36,000, gain 24,000, basis left 564,000. Taxable income 24,000 −
    // 16,100 (2026 Single standard deduction, Rev. Proc. 2025-32 § 4.14)
    // = 7,900, all gains, under the 49,450 0% top (§ 4.03): tax 0.
    const r = retired("H4", 2026);
    const brokerage = r.individualAccountBalances.find(
      (a) => a.name === "A-brokerage",
    )!;
    const basisLeft = brokerage.costBasis ?? NaN;
    ledgerRow(
      {
        withdrawal: r.totalWithdrawal,
        gain: r.totalWithdrawal - (600_000 - basisLeft),
        basisLeft,
        tax: r.taxCost,
      },
      { withdrawal: 60_000, gain: 24_000, basisLeft: 564_000, tax: 0 },
      { row: 0 },
    );
  });

  describe("engine/H4-end", () => {
    // The ledger's 2054 row (age 76): end 1,488,848.47 − 91,517.11
    // spent − 11,476.04 tax + 69,292.77 growth = 1,455,148.09
    // (`H4.ledger.csv`). Today the plan's last year is 2053, so there's no
    // figure to pin (H4 above runs the same input). ±$1 a row: row 28.
    xfail({
      id: "engine/H4-end [ENG-01]",
      todo: END_YEAR,
      run: () => endBalance(project("H4").result, 2054),
      expected: 1_455_148.09,
      tolerance: 29,
    });
  });
});

describe("answer key: engine ledger H6 (penalty priced in the gross-up)", () => {
  // Single, born 1977-07-01, no job. One Traditional IRA 2,000,000; 6%,
  // 3% inflation; spending 40,000. Penalized withdrawals allowed on the
  // account (README: the default draws $0 before 59 1/2 and shows 40,000
  // unmet). 59 1/2 on 2037-01-01; first RMD 2052 (age 75) above the need.
  // Today 2026–2036 also carry an "insufficient funds" warning while unmet
  // is 0 (key § Re-run), so no test here asserts "no warnings".
  const H6 = { allowPenalizedWithdrawals: true };

  it("engine/H6 [ENG-01] every ledger row 2026–2053", () => {
    expectLedger("H6", { from: 2026, to: 2053 }, H6);
  });

  it("engine/H6-2026 [WDR-06] the 10% penalty in the gross-up", () => {
    // Spec § 16. Taxable income W − 16,100; tax = 1,240 (10% to 12,400) +
    // 12% × (W − 16,100 − 12,400) = 0.12W − 2,180 (Rev. Proc. 2025-32 §
    // 4.01 Table 3, § 4.14). Penalty 10% × W (IRC § 72(t)(1); age 48 in
    // 2026). W − tax − penalty = 40,000 → 0.78W = 37,820 → W = 48,487.18;
    // penalty 4,848.72; income tax 3,638.46. End = (2,000,000 − 48,487.18)
    // × 1.06 = 2,068,603.59 (growth after the draw, README § Order).
    const r = retired("H6", 2026, H6);
    ledgerRow(
      {
        withdrawal: r.totalWithdrawal,
        penalty: r.penaltyCost ?? NaN,
        tax: r.taxCost,
        end: r.retirementBalance,
      },
      {
        withdrawal: 48_487.18,
        penalty: 4_848.72,
        tax: 3_638.46,
        end: 2_068_603.59,
      },
      { row: 0, balanceKeys: ["end"] },
    );
  });

  describe("engine/H6-end", () => {
    // The ledger's 2054 row (age 77): 5,627,509.01 − 91,517.11 spent −
    // 30,664.94 tax + 330,319.62 growth = 5,835,646.58 (`H6.ledger.csv`).
    xfail({
      id: "engine/H6-end [ENG-01]",
      todo: END_YEAR,
      run: () => endBalance(project("H6", H6).result, 2054),
      expected: 5_835_646.58,
      tolerance: 29,
    });
  });
});

describe("answer key: engine ledger H3 (retired couple, Social Security and RMDs)", () => {
  // MFJ, A born 1954-01-15 (72), B 1960-01-15 (66), no jobs. A: 401(k)
  // 2,400,000 and Roth IRA 200,000; B: Traditional IRA 450,000. SS 34,000
  // (A, from 67) and 22,000 (B, from 62), both already claimed; 5%, 3%
  // inflation; spending 110,000. Every difference from the ledger is K1:
  // the engine gives no senior deduction in the first retired year.

  describe("engine/H3-2026", () => {
    // Spec § 16. Need 110,000 − 56,000 SS = 54,000. Provisional income W +
    // 28,000; taxable SS = 0.85 × (W + 28,000 − 44,000) + 6,000 = 0.85W −
    // 7,600 (Pub 915 Worksheet 1, MFJ 32,000/44,000; under 85% of SS).
    // Deductions 32,200 + 2 × 1,650 (both 65+) + 2 × 6,000 senior (MAGI
    // under 150,000; Schedule 1-A) = 47,500. TI = 1.85W − 55,100; tax =
    // 2,480 + 12% × (TI − 24,800) = 0.222W − 7,108 (Rev. Proc. 2025-32 §
    // 4.01 Table 1). W − tax = 54,000 → 0.778W = 46,892 → W = 60,272.49,
    // tax 6,272.49. Today, no senior amount in year 1: tax = 0.222W −
    // 5,668, W = 48,332 / 0.778 = 62,123.39, tax 8,123.39.
    xfail({
      id: "engine/H3-2026 [TAX-22]",
      todo: `${SAME_YEAR_MAGI} (K1: the year-1 senior deduction, with "One returnDeductions()")`,
      run: () => {
        const r = retired("H3", 2026);
        return { withdrawal: r.totalWithdrawal, tax: r.taxCost };
      },
      expected: { withdrawal: 60_272.49, tax: 6_272.49 },
      today: { withdrawal: 62_123.39, tax: 8_123.39 },
      tolerance: 1,
    });
  });

  describe("engine/H3-2027", () => {
    // Spec § 16. A is 73: RMD = 2,456,713.89 (A's 401(k) end of 2026,
    // `H3.accounts.csv`) ÷ 26.5 (Pub 590-B Table III, age 73) = 92,706.18,
    // above the need, so W = the RMD. SS 56,000 × 1.03 = 57,680; taxable
    // SS = min(0.85 × 57,680, …) = 49,028. AGI 141,734.18; deductions
    // (32,200 + 3,300) × 1.03 + 12,000 senior (MAGI under 150,000) =
    // 48,565 (C1: indexed figures grown unrounded). TI 93,169.18; tax =
    // 2,554.40 + 12% × (93,169.18 − 25,544) = 10,669.42. Need 113,300 −
    // 57,680 = 55,620; reinvested 92,706.18 − 10,669.42 − 55,620 =
    // 26,416.76, all basis. Today 2026 over-draws by 1,850.90 (H3-2026),
    // so A's 401(k) ends 2026 at 2,454,770.44: RMD 92,632.85, tax
    // 10,660.62, reinvested 26,352.23 (key § Re-run).
    xfail({
      id: "engine/H3-2027 [RET-06]",
      todo: `${SAME_YEAR_MAGI} (K1's knock-on: 2026's over-draw moves the 2027 balance)`,
      run: () => {
        const r = retired("H3", 2027);
        const reinvestedTo = r.individualAccountBalances.find(
          (a) => a.name === "projection-brokerage",
        );
        return {
          rmd: r.rmdAmount,
          tax: r.taxCost,
          reinvested: r.rmdExcessAmount,
          basis: reinvestedTo?.costBasis ?? NaN,
        };
      },
      expected: {
        rmd: 92_706.18,
        tax: 10_669.42,
        reinvested: 26_416.76,
        basis: 26_416.76,
      },
      today: { rmd: 92_632.85, tax: 10_660.62, reinvested: 26_352.23 },
      // The RMD reads 2026's balance: ±$1 a row, row 1.
      tolerance: 2,
    });
  });

  describe("engine/H3", () => {
    // Every row of `H3.ledger.csv` and `H3.accounts.csv`, 2026–2037. Each
    // row 2026–2036 differs only through K1 (verdict); 2037 is the end
    // year, so it also needs D10.
    xfail({
      id: "engine/H3 [ENG-01]",
      todo: `${SAME_YEAR_MAGI} (K1), then ${END_YEAR} for 2037`,
      run: () => ({ rowsOff: rowsOff("H3") }),
      expected: { rowsOff: 0 },
    });
  });
});

describe("answer key: engine ledger H7 (a plan that fails)", () => {
  // Single, born 1956-01-15 (70), no job. Traditional IRA 250,000; SS
  // 20,000 from 67 (claimed); 5%, 3% inflation; spending 50,000. First RMD
  // 2029 (age 73) inside the draw; money runs out in 2034; 2036 unmet =
  // 50,000 × 1.03^10 − 20,000 × 1.03^10 = 67,195.82 − 26,878.33 =
  // 40,317.49. Born 1956, 70 in 2026, so K1 (no year-1 senior deduction)
  // moves 2026's tax and every balance after; 2036 is the end year (D10).
  describe("engine/H7", () => {
    xfail({
      id: "engine/H7 [ENG-27]",
      todo: `${SAME_YEAR_MAGI} (K1), then ${END_YEAR} for 2036`,
      run: () => {
        const { result } = project("H7");
        const last = result.projectionByYear.find((y) => y.year === 2036);
        return {
          rowsOff: rowsOff("H7"),
          depletionYear: result.retirementDepletionYear ?? NaN,
          unmet2036:
            last?.phase === "decumulation" ? (last.unmetNeed ?? 0) : NaN,
        };
      },
      expected: { rowsOff: 0, depletionYear: 2034, unmet2036: 40_317.49 },
    });
  });
});

describe("answer key: engine ledger H2 (two earners, gap years)", () => {
  // MFJ. A born 1964-01-15, 403(b) 1,500,000, 5% of 110,000 pay, works to
  // 2027. B born 1968-01-15, 401(k) 350,000 Traditional + 60,000 Roth, 10%
  // Traditional + 2% Roth of 85,000 with a 100% match to 4%, works to
  // 2032. Both raises 3%; 5% return, 3% inflation; spending 105,000; SS
  // 32,000 and 28,000 from 67. Gap years 2028–2032, phase change 2033,
  // first RMDs 2039 (A) and 2043 (B).

  describe("engine/H2", () => {
    // Every row of `H2.ledger.csv` / `H2.accounts.csv`, 2026–2044. Today
    // differs in E2, E3, E4 and E10 (engine verdicts); rows 2028–2032 are
    // to be rebuilt per D7 (the person's real paycheck net) before this can
    // pass, and 2044 is the end year (D10).
    xfail({
      id: "engine/H2 [ENG-15]",
      todo: `${GAP_YEARS} (E4, E10; with E2, E3, D7's rebuild of 2028–2032, and D10 for 2044)`,
      run: () => ({ rowsOff: rowsOff("H2") }),
      expected: { rowsOff: 0 },
    });
  });

  describe("engine/E3", () => {
    // Verdict E3 (`account-types.ts:516-520`, `getRothFraction`): a
    // 403(b) reads the 401(k)'s Roth share through its IRS limit group, so
    // A's 403(b) takes B's 401(k) split. A puts 5% × 110,000 = 5,500 into
    // A's Traditional 403(b) in 2026 (`H2.accounts.csv`). Today the 401(k)
    // share, B's 1,700 Roth of 10,200 = 1/6, marks 916.67 of A's money
    // Roth; A has no Roth 403(b), and it isn't saved anywhere: 5,500 × 5/6
    // = 4,583.33. Shows only with the payload's
    // base-year contributions filled (year 0 then runs the slot path).
    // Pinned today by `tests/config/account-type-config.test.ts:219`
    // ("403b shares 401k split"), the only test the fix changes.
    xfail({
      id: "engine/E3 [ENG-10]",
      todo: ROTH_SPLIT_403B,
      run: () => {
        const r = runOneYear(
          ledgerInput(readHousehold("H2"), { baseYear: true }),
          2026,
        );
        const a = r.individualAccountBalances.find(
          (x) => x.name === "A-403b-trad",
        );
        return { contribution: a?.contribution ?? NaN };
      },
      expected: { contribution: 5_500 },
      today: { contribution: 4_583.33 },
    });
  });
});

describe("answer key: engine ledgers blocked", () => {
  it.todo(
    `engine/H1: blocked on v0.11 Engine "Tests: NIIT in the gross-up and the 10% penalty survive mutation" (D11's true fixed-dollar option; the HSA "fixed" amount grows with limits from 2027, E9)`,
  );
  it.todo(
    `engine/H5: blocked on v0.11 Engine "Tests: NIIT in the gross-up and the 10% penalty survive mutation" (D11's true fixed-dollar option; its $36,000 fixed Roth is the E8 case)`,
  );
});
