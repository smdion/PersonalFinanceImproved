/**
 * Answer key, Roth withdrawals (v0.10.5 overnight batch): which part of a
 * draw is basis (RET-24) and which part is taxed (TAX-27). Worked by hand
 * from the statute first, never read from `src/`. Invented figures only.
 *
 * Citations: IRC 408A(d)(4)(B) and Pub 590-B (2025) "Ordering Rules for
 * Distributions" (a Roth IRA pays out regular contributions first, then
 * conversions, then earnings); IRC 72(e)(8) and 402A(d) with Pub 575
 * (2025) (a non-qualified distribution from a designated Roth account is
 * basis in the ratio of the account's basis to its balance just before);
 * IRC 408A(d)(1), (d)(2)(A)(i) (a qualified distribution, after 59½, is
 * not income) and 72(a) (earnings in a non-qualified one are). The five-
 * year clock (408A(d)(2)(B)) isn't asked here: Ledgr has no input for the
 * first Roth year (the row's Gaps column says so), so every owner below
 * is taken as past it.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import {
  drawFromBasis,
  type RothBasisState,
} from "@/lib/pure/accounts/roth-basis-tracking";
import { splitRothWithdrawalForTax } from "@/lib/pure/tax/roth-distribution-tax";

const state = (contribution: number, conversion: number): RothBasisState => ({
  contributionBasis: contribution,
  conversionBasis: conversion,
  latestConversionYear: null,
  sourceYear: 2026,
  isSeeded: false,
  stale: false,
});

describe("answer key: which part of a Roth draw is basis", () => {
  it("ret/RET24-1 [RET-24] a Roth IRA: contributions, then conversions, then earnings", () => {
    // Balance 30,000: contributions 10,000, conversions 5,000, earnings
    // 15,000. A 12,000 draw: 10,000 contributions + 2,000 conversions + 0
    // earnings. A 20,000 draw: 10,000 + 5,000 + 5,000 earnings.
    const draw = (w: number) =>
      drawFromBasis({
        state: state(10_000, 5_000),
        orderingRule: "basis_first",
        balanceBeforeWithdrawal: 30_000,
        withdrawal: w,
      });
    cents(
      {
        small: draw(12_000).conversionDrawn,
        smallGrowth: draw(12_000).growthDrawn,
        bigContribution: draw(20_000).contributionDrawn,
        bigConversion: draw(20_000).conversionDrawn,
        bigGrowth: draw(20_000).growthDrawn,
      },
      {
        small: 2_000,
        smallGrowth: 0,
        bigContribution: 10_000,
        bigConversion: 5_000,
        bigGrowth: 5_000,
      },
    );
  });

  it("ret/RET24-2 [RET-24] a Roth 401(k): basis in proportion to the balance", () => {
    // Designated Roth balance 50,000 with 40,000 of contributions; a
    // 10,000 non-qualified draw is 10,000 × 40,000 / 50,000 = 8,000 basis
    // and 2,000 earnings (72(e)(8)).
    const d = drawFromBasis({
      state: state(40_000, 0),
      orderingRule: "pro_rata",
      balanceBeforeWithdrawal: 50_000,
      withdrawal: 10_000,
    });
    cents(
      { basis: d.contributionDrawn + d.conversionDrawn, growth: d.growthDrawn },
      { basis: 8_000, growth: 2_000 },
    );
  });
});

describe("answer key: which part of a Roth draw is taxed", () => {
  // RET24-1's 20,000 draw: 10,000 contributions, 5,000 conversions, 5,000
  // earnings.
  const draws = new Map([
    [
      "a",
      { contributionDrawn: 10_000, conversionDrawn: 5_000, growthDrawn: 5_000 },
    ],
  ]);

  it("tax/TAX27-1 [TAX-27] before 59½ the earnings are income, the basis isn't", () => {
    // Owner born 1976, 50 in 2026: not qualified. Taxable 5,000 (72(a));
    // tax-free 15,000 (408A(d)(4) basis).
    const r = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: 1976 }],
      draws,
      year: 2026,
    });
    cents(
      { taxable: r.taxableGrowth, taxFree: r.taxFreeAmount },
      { taxable: 5_000, taxFree: 15_000 },
    );
  });

  it("tax/TAX27-2 [TAX-27] past 59½ the whole draw is tax-free", () => {
    // Owner born 1960, 66 in 2026: a qualified distribution, 408A(d)(1):
    // taxable 0, tax-free 20,000.
    const r = splitRothWithdrawalForTax({
      accounts: [{ indKey: "a", ownerBirthYear: 1960 }],
      draws,
      year: 2026,
    });
    cents(
      { taxable: r.taxableGrowth, taxFree: r.taxFreeAmount },
      { taxable: 0, taxFree: 20_000 },
    );
  });
});
