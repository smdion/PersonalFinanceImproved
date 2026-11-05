/**
 * Answer key, paycheck properties (spec `specs/paycheck.md` § 10, PW-10):
 * rules any paycheck implementation must hold, checked on random invented
 * jobs (2026 tables, as shipped). Cases from the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Paycheck); the bracketed part of
 * each title is the docs/CALCULATIONS.md row.
 *
 * The closed forms (spec PW-6.8, PW-7.9, from IRC 3101(a), 3121(a)(1),
 * 3102(f)) for one employer's year with Social Security and Medicare wages
 * W: SS = 6.2% × min(W, 184,500); Additional Medicare withheld = 0.9% ×
 * max(0, W − 200,000); Medicare 1.45% × W. A schedule rounds each check's
 * lines to the cent, so its sums may differ from the closed form by
 * ±$0.01 a check (PW-3.15).
 *
 * Not written here: PW-10.3 (nondecreasing withholding except at the
 * table seams), PW-10.5 (a § 125 dollar lowers all three wages) and
 * PW-10.6 (Step 3 never below Step 4(c)) aren't in the key's ready list;
 * PW-10.6 needs a W-4 Step 3 input (v0.11 Paycheck "No W-4 Step 3 / 4(a) /
 * 4(b) input").
 *
 * FAST_CHECK_NUM_RUNS=200 for a deeper run (default 20).
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  account,
  job,
  liabilityInput,
  limit,
} from "./fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { calculateHouseholdTax } from "@/lib/calculators/tax";
import type { PaycheckResult } from "@/lib/pure/types/calculators";
import type { PayPeriodType } from "@/lib/pure/types/shared";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? "20", 10);

const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_RATE = 0.009;
const SS_BASE_2026 = 184_500;
const ADDITIONAL_THRESHOLD = 200_000;

const PERIODS: Record<PayPeriodType, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

const period = fc.constantFrom<PayPeriodType>(
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
);
const status = fc.constantFrom<ReturnFilingStatus>("Single", "MFJ", "HOH");
const salary = fc.integer({ min: 0, max: 600_000 });
/** A bonus, or none, dated somewhere in the year. */
const bonus = fc.record({
  amount: fc.constantFrom(0, 5_000, 40_000, 150_000),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
});

const total = (
  r: PaycheckResult,
  f: (p: PaycheckResult["yearSchedule"][number]) => number,
) => r.yearSchedule.reduce((a, p) => a + f(p), 0);

/** The year's Social Security and Medicare wages: the checks' plus the
 *  bonus's. */
const yearWages = (r: PaycheckResult) =>
  r.ficaWages * r.periodsPerYear +
  (r.bonusPeriod ? r.bonusEstimate.bonusFicaWages : 0);

/** All FICA on the schedule, bonus rows included. */
const yearFica = (r: PaycheckResult) =>
  total(r, (p) => p.ficaSS + p.ficaMedicare + p.bonusFica);

/** The closed form for the same wages (PW-6.8 + PW-7.2 + PW-7.9). */
const closedFica = (w: number) =>
  SS_RATE * Math.min(w, SS_BASE_2026) +
  MEDICARE_RATE * w +
  ADDITIONAL_RATE * Math.max(0, w - ADDITIONAL_THRESHOLD);

function run(c: {
  salary: number;
  period: PayPeriodType;
  status?: ReturnFilingStatus;
  bonus?: { amount: number; month: number; day: number };
}) {
  const b = c.bonus && c.bonus.amount > 0 ? c.bonus : null;
  return calculatePaycheck(
    job({
      salary: c.salary,
      period: c.period,
      status: c.status,
      ...(b ? { bonus: b.amount, bonusMonth: b.month, bonusDay: b.day } : {}),
    }),
  );
}

const within = (actual: number, expected: number, checks: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.01 * checks + 1e-6);

describe("paycheck PW-10 properties", () => {
  it("paycheck/PW-10.1 [PAY-19] the schedule's year totals equal the closed forms", () => {
    // Without a bonus each tax is checked alone: Σ SS = 6.2% × min(W,
    // base); Σ (Medicare − 1.45% of the check) = 0.9% × max(0, W −
    // 200,000). With a bonus on the schedule the check's FICA is split pro
    // rata between pay and bonus (verdict N8), so the year's FICA is
    // checked as a whole against the sum of the closed forms.
    fc.assert(
      fc.property(salary, period, bonus, (s, p, b) => {
        const plain = run({ salary: s, period: p });
        const w = yearWages(plain);
        const checks = PERIODS[p];
        within(
          total(plain, (x) => x.ficaSS),
          SS_RATE * Math.min(w, SS_BASE_2026),
          checks,
        );
        within(
          total(plain, (x) => x.ficaMedicare),
          MEDICARE_RATE * w +
            ADDITIONAL_RATE * Math.max(0, w - ADDITIONAL_THRESHOLD),
          checks,
        );
        const withBonus = run({ salary: s, period: p, bonus: b });
        within(
          yearFica(withBonus),
          closedFica(yearWages(withBonus)),
          checks + 1,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("paycheck/PW-10.2 [PAY-19] moving the bonus to another check changes no year FICA", () => {
    // PW-8.2: timing moves which check bears the tax, never the total.
    fc.assert(
      fc.property(salary, period, bonus, bonus, (s, p, b1, b2) => {
        const amount = Math.max(b1.amount, 5_000);
        const first = run({ salary: s, period: p, bonus: { ...b1, amount } });
        const second = run({ salary: s, period: p, bonus: { ...b2, amount } });
        within(yearFica(first), yearFica(second), PERIODS[p] + 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("paycheck/PW-10.4 [PAY-04] a dollar from traditional to Roth moves only income-tax wages", () => {
    // PW-4.2, PW-4.3: a traditional deferral is outside income-tax wages
    // only; a Roth deferral is inside all three. Moving $1 a check raises
    // income-tax wages by $1 and leaves FICA wages, SS and Medicare alone.
    fc.assert(
      fc.property(
        fc.integer({ min: 20_000, max: 400_000 }),
        period,
        fc.integer({ min: 1, max: 500 }),
        (s, p, traditional) => {
          const checks = PERIODS[p];
          const deferrals = (pre: number, roth: number) =>
            calculatePaycheck(
              job({
                salary: s,
                period: p,
                accounts: [
                  account({
                    name: "401(k)",
                    perCheck: pre,
                    checks,
                    treatment: "pre_tax",
                  }),
                  account({
                    name: "Roth 401(k)",
                    perCheck: roth,
                    checks,
                    treatment: "tax_free",
                  }),
                ],
              }),
            );
          const before = deferrals(traditional, 0);
          const after = deferrals(traditional - 1, 1);
          expect(
            after.federalTaxableGross - before.federalTaxableGross,
          ).toBeCloseTo(1, 6);
          expect(after.ficaWages).toBe(before.ficaWages);
          expect(after.ficaSS).toBe(before.ficaSS);
          expect(after.ficaMedicare).toBe(before.ficaMedicare);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("paycheck/PW-10.7 [PAY-12] Additional Medicare withheld ignores filing status; owed ignores employers", () => {
    // Withheld: IRC 3102(f), Form 8959 instructions (the employer test is
    // wages over 200,000, whatever the W-4 says). Owed: the return
    // combines all Medicare wages (Form 8959 line 4), so splitting the
    // same wages across two employers owes the same.
    fc.assert(
      fc.property(
        salary,
        period,
        status,
        status,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, p, a, b, share) => {
          const additional = (r: PaycheckResult) =>
            total(r, (x) => x.ficaMedicare) - MEDICARE_RATE * yearWages(r);
          within(
            additional(run({ salary: s, period: p, status: a })),
            additional(run({ salary: s, period: p, status: b })),
            PERIODS[p],
          );
          const owed = (people: number[]) =>
            calculateHouseholdTax({
              people: people.map((w) => ({ federalWages: w, ficaWages: w })),
              taxBrackets: liabilityInput("Single"),
              medicareLiabilityThreshold: limit(
                2026,
                "fica_medicare_surtax_liability_single",
              ),
            }).additionalMedicare;
          const one = Math.round(s * share * 100) / 100;
          expect(
            Math.abs(owed([s]) - owed([one, s - one])),
          ).toBeLessThanOrEqual(0.01);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("paycheck/PW-10.8 [PAY-10] more pay never lowers the year's SS, and it stops at the base", () => {
    // PW-6.2, PW-6.8: SS grows with wages to 6.2% × 184,500 = 11,439.00.
    fc.assert(
      fc.property(
        salary,
        fc.integer({ min: 0, max: 200_000 }),
        period,
        (s, extra, p) => {
          const checks = PERIODS[p];
          const ss = (pay: number) =>
            total(run({ salary: pay, period: p }), (x) => x.ficaSS);
          expect(ss(s + extra)).toBeGreaterThanOrEqual(ss(s) - 0.01 * checks);
          expect(ss(s + extra)).toBeLessThanOrEqual(11_439 + 0.01 * checks);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
