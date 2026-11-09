/**
 * Answer key, one working year (ENG-33) and one retirement year (ENG-32)
 * as hand ledgers, per account (v0.10.5 overnight batch 3). Arithmetic:
 * money is conserved, so each account ends the year at
 *
 *   start + contributions + match − withdrawals + growth,
 *
 * growth being the year's return on what the account holds when growth is
 * applied. ARCHITECTURE.md § One year sets that order: a working year
 * credits the year's contributions, then grows (`distributeYearContributions`
 * before `applyGrowth`); a retirement year takes the draws, then grows
 * (`settleYearDraws` before `closeDecumulationYear`). Basis is what was
 * paid in (IRC 1012): contributions add to it, growth doesn't, a draw at
 * full basis takes its own amount. Every figure is worked by hand first,
 * never read from `src/`. Invented households only, 5% return, 0%
 * inflation, the plan starting 2026-01-01 (a whole year 0).
 */
import { describe, it } from "vitest";
import { ledgerRow, runOneYear } from "../../fixtures/answer-key";
import {
  engineHousehold,
  type KeyHousehold,
} from "../../fixtures/answer-key-household";
import type { ProjectionInput } from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";

const FIVE_PERCENT = [{ label: "Age 0", rate: 0.05 }];

/** The household at 5%, saving `rate` of pay, all of it to the brokerage. */
function at5(h: KeyHousehold, rate = 0): ProjectionInput {
  const base = engineHousehold(h);
  const splits = Object.fromEntries(
    Object.keys(base.accumulationDefaults.accountSplits).map((c) => [
      c,
      c === "brokerage" ? 1 : 0,
    ]),
  ) as Record<AccountCategory, number>;
  return {
    ...base,
    returnRates: FIVE_PERCENT,
    accumulationDefaults: {
      ...base.accumulationDefaults,
      contributionRate: rate,
      accountOrder: ["brokerage"],
      accountSplits: splits,
    },
  };
}

function balances(input: ProjectionInput) {
  const r = runOneYear(input, 2026);
  const of = (taxType: string) =>
    r.individualAccountBalances
      .filter((a) => a.taxType === taxType)
      .reduce((s, a) => s + a.balance, 0);
  // A working year draws nothing; a retirement year reports its draw.
  const withdrawal = r.phase === "decumulation" ? r.totalWithdrawal : 0;
  return { withdrawal, ira: of("preTax"), brokerage: of("afterTax") };
}

describe("answer key: one year, per account", () => {
  it("engine/ENG33-1 [ENG-33] a working year: contributions in, then growth", () => {
    // Single, born 1980, $100,000 a year to 2040, saving 10% (10,000) to
    // a brokerage; spending is covered by pay, so nothing is drawn.
    // Brokerage: (50,000 + 10,000) × 1.05 = 63,000.00 (start 50,000 +
    // contributions 10,000 + growth 3,000). Traditional IRA, no
    // contributions: 100,000 × 1.05 = 105,000.00.
    const b = balances(
      at5(
        {
          status: "Single",
          people: [
            { birthYear: 1980, job: { salary: 100_000, lastYear: 2040 } },
          ],
          traditionalIra: 100_000,
          brokerage: { balance: 50_000, basis: 50_000 },
          spending: 60_000,
          endYear: 2045,
        },
        0.1,
      ),
    );
    ledgerRow(
      { brokerage: b.brokerage, ira: b.ira },
      { brokerage: 63_000, ira: 105_000 },
      { row: 0, balanceKeys: ["brokerage", "ira"] },
    );
  });

  it("engine/ENG32-1 [ENG-32] a retirement year: the draw out, then growth", () => {
    // Single, born 1962 (64: no 65+ deduction, no Social Security), a
    // $500,000 brokerage at full basis, spending $40,000. The sale has no
    // gain, so no tax: draw 40,000. Brokerage (500,000 − 40,000) × 1.05 =
    // 483,000.00 (start 500,000 − withdrawals 40,000 + growth 23,000).
    const b = balances(
      at5({
        status: "Single",
        people: [{ birthYear: 1962 }],
        brokerage: { balance: 500_000, basis: 500_000 },
        spending: 40_000,
        endYear: 2027,
      }),
    );
    ledgerRow(
      {
        withdrawal: b.withdrawal,
        brokerage: b.brokerage,
      },
      { withdrawal: 40_000, brokerage: 483_000 },
      { row: 0, balanceKeys: ["brokerage"] },
    );
  });

  it("engine/ENG32-2 [ENG-32] a retirement year from two accounts: each loses only its own draw", () => {
    // The same person with a $300,000 Traditional IRA and the $500,000
    // brokerage, drawing the IRA first (waterfall). The IRA draw grosses
    // up for its tax: W − tax(W) = 40,000, W = 42,977.27, tax 2,977.27
    // (worked in engine/ENG18-2: RP25 Single, 12% band). IRA: (300,000 −
    // 42,977.27) × 1.05 = 269,873.87 (to the cent: 257,022.73 × 1.05 =
    // 269,873.8665). The brokerage isn't touched: 500,000 × 1.05 =
    // 525,000.00.
    const b = balances(
      at5({
        status: "Single",
        people: [{ birthYear: 1962 }],
        traditionalIra: 300_000,
        brokerage: { balance: 500_000, basis: 500_000 },
        spending: 40_000,
        endYear: 2027,
      }),
    );
    ledgerRow(
      { withdrawal: b.withdrawal, ira: b.ira, brokerage: b.brokerage },
      { withdrawal: 42_977.27, ira: 269_873.87, brokerage: 525_000 },
      { row: 0, balanceKeys: ["ira", "brokerage"] },
    );
  });
});
