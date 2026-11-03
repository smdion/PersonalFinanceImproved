/**
 * Answer key, household: loan payments, payoff months, the amortization
 * schedule, dated extras, what-ifs and the feed balance (`.scratch/docs/
 * drafts/answer-key.md` § Household math; rulings in `reviews/2026-11-01/
 * rebuild/household-verdicts.md`, worked cases in `reviews/2026-11-01/
 * specs/household-math.md` § 2). Ids are the spec's own, prefixed
 * `household/`; the bracketed part is the docs/CALCULATIONS.md row.
 *
 * Every figure is worked by hand from the published formula, never read
 * from `src/`:
 * - Level payment `A = P·i / (1 − (1+i)^−n)`, `i = rate / 12`, and
 *   `A = P / n` at 0% (spec S1–S3; 12 CFR 1026.17(c)(3) lets a creditor
 *   treat every month as 1/12 of a year).
 * - Payoff months `N = −ln(1 − P·i/A) / ln(1+i)`, rounded up; `P/A` at 0%;
 *   never when `A ≤ P·i` (S16, S17).
 * - The schedule month by month: interest = balance × i, rounded to the
 *   cent; principal = payment − interest; an extra goes to principal after
 *   the month's interest and is capped at what's left (S6, S11, S12). A
 *   fully amortizing loan's last payment clears it (12 CFR 1026.43(b)(2);
 *   S8). Schedules were iterated in exact decimals, outside the repo.
 * - A what-if adds only to months after its start (S15); a feed balance
 *   wins over the amortized one (S25, RULES § Shared State Sources).
 *
 * Inputs: invented loans. Ledgr dates schedule row `m` at the loan's
 * `startDate` plus `m` months (v0.11 Household math "Mortgage a month
 * behind" is about that dating; no figure here depends on it): with a
 * start of 2020-01-01, row 12 is January 2021 and row 61 February 2025.
 *
 * `tests/calculators/mortgage.test.ts:15`'s fixture P&I (1,770.09) is
 * G3's pin and stays as it is (labelled there); C6 below has the true
 * payment.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import { calculateMortgage } from "@/lib/calculators/mortgage";
import type {
  MortgageExtraPayment,
  MortgageInput,
  MortgageLoanInput,
  MortgageWhatIf,
} from "@/lib/calculators/types";
import {
  calculateLoanMonthlyPayment,
  loanPayoffMonths,
} from "@/lib/utils/math";

/** v0.11.x.md § Household math, the loan-math item (G3, G4, G7). */
const LOAN_MATH = 'v0.11 Household math "Loan math"';
/** v0.11.x.md § Household math, the one-time what-if item (G1). */
const ONE_TIME_WHAT_IF =
  'v0.11 Household math "Mortgage what-if ignores the one-time payment"';

const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/** The household/C1 loan: 200,000 at 6% over 360 months, P&I 1,199.10. */
const C1_LOAN: MortgageLoanInput = {
  id: 1,
  name: "Home",
  originalBalance: 200_000,
  interestRate: 0.06,
  termMonths: 360,
  startDate: noon("2020-01-01"),
  monthlyPI: 1_199.1,
  isActive: true,
};

function mortgage(
  opts: {
    loan?: MortgageLoanInput;
    extras?: { month: number; amount: number }[];
    whatIf?: Omit<MortgageWhatIf, "label">[];
    asOf?: string;
  } = {},
) {
  const loan = opts.loan ?? C1_LOAN;
  // Row m is dated startDate + m months; an extra dated the 15th of that
  // month lands on row m.
  const extraPayments: MortgageExtraPayment[] = (opts.extras ?? []).map((e) => {
    const d = new Date(loan.startDate);
    d.setUTCMonth(d.getUTCMonth() + e.month, 15);
    return { loanId: loan.id, date: d, amount: e.amount };
  });
  const input: MortgageInput = {
    loans: [loan],
    extraPayments,
    whatIfScenarios: (opts.whatIf ?? []).map((w) => ({
      label: "what-if",
      ...w,
    })),
    asOfDate: noon(opts.asOf ?? "2020-06-15"),
  };
  return calculateMortgage(input);
}

const schedule = (r: ReturnType<typeof mortgage>) =>
  r.loans[0]!.amortizationSchedule;
const lastRow = (r: ReturnType<typeof mortgage>) => schedule(r).at(-1)!;

describe("household: loan payment and payoff months", () => {
  it("household/C1 [HH-61] 200,000 at 6% over 360 months: 1,199.10", () => {
    // i = 0.005; A = 200,000 × 0.005 / (1 − 1.005^−360) = 1,199.1011 (S1).
    cents(calculateLoanMonthlyPayment(200_000, 0.06, 30), 1_199.1);
  });

  it("household/C4 [HH-61] 300,000 at 6% over 360: 1,798.65, total interest 347,514.57", () => {
    // A = 300,000 × 0.005 / (1 − 1.005^−360) = 1,798.6516; total interest
    // = A × 360 − P = 647,514.57 − 300,000 = 347,514.57 (sum.money gives
    // 1,798.65 and about 347,515).
    const a = calculateLoanMonthlyPayment(300_000, 0.06, 30);
    cents(
      { payment: a, interest: a * 360 - 300_000 },
      {
        payment: 1_798.65,
        interest: 347_514.57,
      },
    );
  });

  it("household/C5 [HH-61] 300,000 at 6.5% over 360: 1,896.20", () => {
    // i = 0.065 / 12; A = 300,000 × i / (1 − (1+i)^−360) = 1,896.2041.
    cents(calculateLoanMonthlyPayment(300_000, 0.065, 30), 1_896.2);
  });

  it("household/C6 [HH-61] 280,000 at 6.5% over 360: 1,769.79", () => {
    // A = 280,000 × i / (1 − (1+i)^−360) = 1,769.7905, i = 0.065/12. Not
    // 1,770.09, the payment on about 280,047.39 (verdict G3; the fixture in
    // mortgage.test.ts:15).
    cents(calculateLoanMonthlyPayment(280_000, 0.065, 30), 1_769.79);
  });

  it("household/C7 [HH-61] 120,000 at 0% over 360: 333.33, never 0", () => {
    // i = 0, so A = P / n = 120,000 / 360 = 333.33 (S3).
    cents(calculateLoanMonthlyPayment(120_000, 0, 30), 333.33);
  });

  it("household/C8 [HH-61] 200,000 at 6% over 180: 1,687.71", () => {
    // A = 200,000 × 0.005 / (1 − 1.005^−180) = 1,687.7137.
    cents(calculateLoanMonthlyPayment(200_000, 0.06, 15), 1_687.71);
  });

  it("household/C15 [HH-61] 100,000 at 6% paying 500: never pays off", () => {
    // P·i = 100,000 × 0.005 = 500 = A: the interest takes the whole
    // payment and the balance never falls (S17). Ledgr's "never" is null.
    expect(loanPayoffMonths(100_000, 0.06, 500)).toBeNull();
  });

  it("household/C17 [HH-01] 10,000 at 0% paying 300: 34 payments, last 100, no interest", () => {
    // N = 10,000 / 300 = 33.33, rounded up to 34 (S16); 33 × 300 = 9,900,
    // so payment 34 is 100; at 0% no interest at all.
    expect(loanPayoffMonths(10_000, 0, 300)).toBe(34);
    const r = mortgage({
      loan: {
        ...C1_LOAN,
        originalBalance: 10_000,
        interestRate: 0,
        termMonths: 34,
        monthlyPI: 300,
      },
    });
    const last = lastRow(r);
    expect(schedule(r)).toHaveLength(34);
    cents(
      {
        last: last.principal + last.interest,
        interest: r.loans[0]!.totalInterestLife,
      },
      { last: 100, interest: 0 },
    );
  });
});

describe("household: the schedule and dated extras", () => {
  it("household/C11 [HH-01] 150,000 at 5% over 360, +100 a month: 283 months, 34,605.18 saved", () => {
    // A = 150,000 × (0.05/12) / (1 − (1 + 0.05/12)^−360) = 805.2324. With
    // exact interest and +100 a month the loan ends at month 283 (77
    // saved) and saves 34,605.18 (Pearson's worked example, via search:
    // 283 months, about 34,605). Ledgr rounds interest to the cent and
    // pays the rounded 805.23, which iterates to 34,606.23; spec S9 says to
    // compare a 30-year total within 2 dollars across the two conventions.
    const loan = {
      ...C1_LOAN,
      originalBalance: 150_000,
      interestRate: 0.05,
      monthlyPI: 805.23,
    };
    const extras = Array.from({ length: 360 }, (_, k) => ({
      month: k + 1,
      amount: 100,
    }));
    const r = mortgage({ loan, extras });
    expect(schedule(r)).toHaveLength(283);
    expect(r.loans[0]!.monthsAheadOfSchedule).toBe(77);
    cents(r.loans[0]!.totalInterestSaved, 34_605.18, 2);
  });

  it("household/C12 [HH-01] C1 with 10,000 extra at month 12: ends month 318, last 517.98, interest 190,632.68", () => {
    // Cent interest on C1 (A 1,199.10): 10,000 more principal in month 12
    // after that month's interest; iterated, the balance clears in month
    // 318 with interest 2.58 and principal 515.40 (517.98), and the
    // interest over the life is 190,632.68.
    const r = mortgage({ extras: [{ month: 12, amount: 10_000 }] });
    const last = lastRow(r);
    expect(schedule(r)).toHaveLength(318);
    cents(
      {
        last: last.principal + last.interest,
        balance: last.balance,
        interest: r.loans[0]!.totalInterestLife,
      },
      { last: 517.98, balance: 0, interest: 190_632.68 },
    );
  });

  xfail({
    id: "household/C9 [HH-01]",
    todo: `${LOAN_MATH} (verdict G3: the last payment absorbs rounding)`,
    // C1 with cent interest at A = 1,199.10: after 359 payments the balance
    // is 1,194.17; month 360's interest is 1,194.17 × 0.005 = 5.97, so a
    // fully amortizing last payment (12 CFR 1026.43(b)(2); S8) is
    // 1,194.17 + 5.97 = 1,200.14 and leaves 0. Total interest over the
    // life is 231,677.04 either way (the stranded 1.04 is principal).
    // Today month 360 pays 1,199.10 (principal 1,193.13) and leaves 1.04.
    run: () => {
      const r = mortgage();
      const last = lastRow(r);
      return {
        payments: schedule(r).length,
        last: last.principal + last.interest,
        balance: last.balance,
        interest: r.loans[0]!.totalInterestLife,
      };
    },
    expected: {
      payments: 360,
      last: 1_200.14,
      balance: 0,
      interest: 231_677.04,
    },
    today: {
      payments: 360,
      last: 1_199.1,
      balance: 1.04,
      interest: 231_677.04,
    },
  });

  xfail({
    id: "household/C27 [HH-01]",
    todo: `${LOAN_MATH} (verdict G3: a loan past its last payment owes 0)`,
    // S10: once the last scheduled payment is made, the balance is 0. As of
    // 2060 every one of C1's 360 payments has been made (row 360 is
    // 2050-01). Today the 1.04 from C9 stays owed for ever.
    run: () => mortgage({ asOf: "2060-06-15" }).loans[0]!.currentBalance,
    expected: 0,
    today: 1.04,
  });

  xfail({
    id: "household/C14 [HH-01]",
    todo: `${LOAN_MATH} (verdict G4: a row's payment is what was paid)`,
    // 1,000 at 12% paying 500 with 600 extra in month 1: interest
    // 1,000 × 0.01 = 10, principal 490, the extra capped at 1,000 − 490 =
    // 510 (S12): the month pays 10 + 490 + 510 = 1,010 and leaves 0 (today
    // right). 54,000 at 0% paying 175: 308 × 175 = 53,900, so row 309
    // pays the last 100 (S12); today its `payment` says 175.
    run: () => {
      const small = mortgage({
        loan: {
          ...C1_LOAN,
          originalBalance: 1_000,
          interestRate: 0.12,
          termMonths: 3,
          monthlyPI: 500,
        },
        extras: [{ month: 1, amount: 600 }],
      });
      const zero = mortgage({
        loan: {
          ...C1_LOAN,
          originalBalance: 54_000,
          interestRate: 0,
          monthlyPI: 175,
        },
      });
      return {
        firstPayment: schedule(small)[0]!.payment,
        firstBalance: schedule(small)[0]!.balance,
        zeroRows: schedule(zero).length,
        zeroLastPayment: lastRow(zero).payment,
      };
    },
    expected: {
      firstPayment: 1_010,
      firstBalance: 0,
      zeroRows: 309,
      zeroLastPayment: 100,
    },
    today: {
      firstPayment: 1_010,
      firstBalance: 0,
      zeroRows: 309,
      zeroLastPayment: 175,
    },
  });
});

describe("household: what-ifs", () => {
  it("household/C13 [HH-03] C1 with a what-if +200 from month 61: ends month 280, interest 178,814.49", () => {
    // As of 2025-01-15 (row 60, January 2025, already paid), so the
    // what-if's first month is row 61 (S15). Cent interest, A 1,199.10,
    // +200 principal each month from 61: iterated, the loan clears in
    // month 280, 80 months before the 360 of S8, with interest
    // 178,814.49. The verdicts didn't run it ("confirm on first run"):
    // confirmed on this base.
    const r = mortgage({
      asOf: "2025-01-15",
      whatIf: [{ extraMonthlyPrincipal: 200 }],
    });
    const w = r.whatIfResults[0]!;
    expect(w.monthsSaved).toBe(80);
    cents(w.totalInterest, 178_814.49);
  });

  xfail({
    id: "household/C12-wi [HH-03]",
    todo: `${ONE_TIME_WHAT_IF} (verdict G1)`,
    // C12's 10,000 entered as a what-if one-time payment as of 2020-12-15:
    // it lands in the first month after the as-of date, January 2021,
    // row 12, which is C12 exactly. Saved against the plain C1 schedule:
    // 231,677.04 − 190,632.68 = 41,044.36 of interest and 360 − 318 = 42
    // months. Today the one-time amount is never read: 0 and 0.
    run: () => {
      const w = mortgage({
        asOf: "2020-12-15",
        whatIf: [{ extraMonthlyPrincipal: 0, extraOneTimePayment: 10_000 }],
      }).whatIfResults[0]!;
      return { interestSaved: w.interestSaved, monthsSaved: w.monthsSaved };
    },
    expected: { interestSaved: 41_044.36, monthsSaved: 42 },
    today: { interestSaved: 0, monthsSaved: 0 },
  });

  describe("household/G7: a what-if's first month doesn't depend on the server's time zone", () => {
    // RULES § Time Resolution: dates resolve explicitly, not by the server
    // zone. vitest pins TZ=UTC; each run sets the zone and restores it.
    const savedTz = process.env.TZ;
    afterEach(() => {
      process.env.TZ = savedTz;
    });
    const totalInterestIn = (tz: string) => {
      process.env.TZ = tz;
      try {
        return mortgage({
          asOf: "2020-12-15",
          whatIf: [{ extraMonthlyPrincipal: 200 }],
        }).whatIfResults[0]!.totalInterest;
      } finally {
        process.env.TZ = savedTz;
      }
    };
    xfail({
      id: "household/G7 [HH-03]",
      todo: `${LOAN_MATH} (verdict G7: build the what-if month in UTC)`,
      // C1, as of 2020-12-15 12:00 UTC, +200 a month from the next month,
      // January 2021 (row 12): cent interest, iterated, total interest
      // 157,282.42, in any zone. Today in Asia/Tokyo the first extra lands
      // on December 2020 (row 11, already paid), which iterates to
      // 156,800.17.
      run: () => ({
        utc: totalInterestIn("UTC"),
        tokyo: totalInterestIn("Asia/Tokyo"),
      }),
      expected: { utc: 157_282.42, tokyo: 157_282.42 },
      today: { utc: 157_282.42, tokyo: 156_800.17 },
    });
  });
});

describe("household: the feed balance", () => {
  it("household/C26 [HH-05] a feed of 185,000 over the amortized balance: 185,000", () => {
    // As of 2025-01-15, after 60 payments. The amortized balance by the
    // closed form (S7) is 186,108.71; the cent schedule at A 1,199.10
    // gives 186,108.80. The feed, dated the as-of day, wins (S25).
    const r = mortgage({
      asOf: "2025-01-15",
      loan: {
        ...C1_LOAN,
        apiBalance: 185_000,
        apiBalanceDate: noon("2025-01-15"),
      },
    });
    cents(
      {
        current: r.loans[0]!.currentBalance,
        amortized: r.loans[0]!.calculatedBalance!,
      },
      { current: 185_000, amortized: 186_108.8 },
    );
  });
});
