/**
 * Answer key, engine arithmetic (v0.10.5 overnight batch): ages (ENG-36)
 * and a year's return on each balance (ENG-07). Arithmetic rows: every
 * expected figure is worked here by hand, never read from `src/`.
 * Invented people and balances only. Tests run with TZ=UTC
 * (vitest.config.ts), so a stored `YYYY-MM-DD` date and a UTC date agree.
 *
 * Ages: a whole-years age on a date counts the birthdays reached by
 * that date (the birthday itself included); the age "in a year" is the
 * age at December 31, `year − birth year` (age-rules.ts: every rule today
 * is measured then).
 * Growth: a balance grows by (1 + r), rounded to the cent; cost basis is
 * what was paid in and doesn't grow (IRC 1012), so only the brokerage's
 * market value moves.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { getAge, ageInYear } from "@/lib/utils/date";
import {
  limitAge,
  ageOnDate,
  countReachingAgeRule,
} from "@/lib/pure/household/age";
import { growYear } from "@/lib/pure/engine/projection-year-handlers/year-growth";
import { refreshViews } from "@/lib/pure/engine/projection-year-handlers/settle";
import { openingTotals } from "@/lib/pure/engine/opening-parts";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import { makeIndividualAccount } from "../fixtures/engine-fixtures";

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("answer key: ages", () => {
  it("engine/ENG36-1 [ENG-36] the age on a date turns on the birthday itself", () => {
    // Born 1966-07-15. On 2026-07-14: 59 (the 60th birthday not yet
    // reached); on 2026-07-15: 60; on 2026-12-31: 60. Born 1966-12-31, on
    // 2026-01-01: 59.
    expect([
      getAge(utc("1966-07-15"), utc("2026-07-14")),
      getAge(utc("1966-07-15"), utc("2026-07-15")),
      getAge(utc("1966-07-15"), utc("2026-12-31")),
      getAge(utc("1966-12-31"), utc("2026-01-01")),
    ]).toEqual([59, 60, 60, 59]);
  });

  it("engine/ENG36-2 [ENG-36] a stored date of birth: on a date, and in a year", () => {
    // "1966-07-15" on 2026-07-14: 59, and on 2026-07-15: 60. Its age in
    // 2026 (at Dec 31) is 2026 − 1966 = 60 whatever the day, as is a
    // birth year's (ageInYear(1966, 2026)).
    expect([
      ageOnDate("1966-07-15", utc("2026-07-14")),
      ageOnDate("1966-07-15", utc("2026-07-15")),
      limitAge("1966-07-15", 2026),
      limitAge("1966-12-31", 2026),
      ageInYear(1966, 2026),
    ]).toEqual([59, 60, 60, 60, 60]);
  });

  it("engine/ENG36-3 [ENG-36] how many in a household are 65 in a year", () => {
    // Medicare's rule (65 at Dec 31): in 2026, born 1961 is 65, 1962 is
    // 64, 1958 is 68: two of three. With no birth years, the household's
    // one age stands for one person: 66 counts 1, 64 counts 0.
    expect([
      countReachingAgeRule([1961, 1962, 1958], 0, "medicare", 2026),
      countReachingAgeRule(undefined, 66, "medicare", 2026),
      countReachingAgeRule([], 64, "medicare", 2026),
    ]).toEqual([2, 1, 0]);
  });
});

describe("answer key: a year's return on each balance", () => {
  const part = (
    category: IndividualAccountInput["category"],
    taxType: IndividualAccountInput["taxType"],
    startingBalance: number,
    startingBasis?: number,
  ) =>
    makeIndividualAccount({
      name: `${category} ${taxType}`,
      category,
      taxType,
      startingBalance,
      startingBasis,
    });
  /** 100,000 Traditional, 40,000 Roth, 10,000 HSA, a 80,000 brokerage
   *  with 50,000 basis, each one account, grown at `r`; the year's settled
   *  point then gives the categories and the tax buckets their accounts' sums. */
  function grow(
    r: number,
    parts = [
      part("401k", "preTax", 100_000),
      part("401k", "taxFree", 40_000),
      part("hsa", "hsa", 10_000),
      part("brokerage", "afterTax", 80_000, 50_000),
    ],
  ) {
    const { balances, accountBalance } = openingTotals(parts);
    const keyed = (value: (p: IndividualAccountInput) => number | undefined) =>
      new Map(parts.map((p) => [accountIdKeyOf(p), value(p) ?? 0]));
    const run = {
      ledgerRuns: true,
      indAccounts: parts,
      indKey: accountIdKeyOf,
    };
    const loop = {
      balances,
      accountBalance,
      indBalance: keyed((p) => p.startingBalance),
      brokBasis: keyed((p) => p.startingBasis),
    };
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear and refreshViews read
    const ctx = run as unknown as ProjectionContext;
    // eslint-disable-next-line no-restricted-syntax -- only the fields growYear and refreshViews read
    const state = loop as unknown as ProjectionLoopState;
    growYear(ctx, state, r, false);
    refreshViews(ctx, state);
    const b = accountBalance.brokerage;
    return {
      ...balances,
      brokerageValue: b.structure === "basis_tracking" ? b.balance : NaN,
      brokerageBasis: b.structure === "basis_tracking" ? b.basis : NaN,
    };
  }

  it("engine/ENG07-1 [ENG-07] 7%: every balance × 1.07, basis unchanged", () => {
    // 100,000 → 107,000; 40,000 → 42,800; 10,000 → 10,700; 80,000 →
    // 85,600; basis stays 50,000.
    cents(grow(0.07), {
      preTax: 107_000,
      taxFree: 42_800,
      hsa: 10_700,
      afterTax: 85_600,
      afterTaxBasis: 50_000,
      brokerageValue: 85_600,
      brokerageBasis: 50_000,
    });
  });

  it("engine/ENG07-2 [ENG-07] a loss: −20%, basis unchanged", () => {
    // 100,000 → 80,000; 40,000 → 32,000; 10,000 → 8,000; 80,000 →
    // 64,000; a loss doesn't touch basis either: 50,000.
    cents(grow(-0.2), {
      preTax: 80_000,
      taxFree: 32_000,
      hsa: 8_000,
      afterTax: 64_000,
      afterTaxBasis: 50_000,
      brokerageValue: 64_000,
      brokerageBasis: 50_000,
    });
  });

  it("engine/ENG07-3 [ENG-07] rounding to the cent each year", () => {
    // 3.33%: 100,000 → 103,330.00; 40,000 → 41,332.00; 10,000 →
    // 10,333.00; 80,000 → 82,664.00. And a balance with cents: grown
    // twice at 3.33%, 103,330 × 1.0333 = 106,770.889 → 106,770.89.
    const once = grow(0.0333);
    cents(once, {
      preTax: 103_330,
      taxFree: 41_332,
      hsa: 10_333,
      afterTax: 82_664,
    });
    const twice = grow(0.0333, [part("401k", "preTax", once.preTax)]);
    cents(twice.preTax, 106_770.89);
  });
});
