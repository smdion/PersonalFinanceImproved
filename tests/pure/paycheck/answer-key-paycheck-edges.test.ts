/**
 * Answer key, paycheck edges no test reached (the 2026-11-08 test-suite
 * review § 3, survivors P4 and P6; v0.10.5 overnight batch 3). Worked by
 * hand from the publications first, never read from `src/`. Invented
 * jobs only.
 *
 * Citations: IRC 3121(a)(1) with 3121(a)(5)(G) and 125 (the Social
 * Security base, $184,500 in 2026, is measured on FICA wages: cafeteria-
 * plan money never uses it); Pub 15 (2026) § 7 (a bonus at the flat 22%)
 * and § 9 (6.2% to the base, 1.45% Medicare); Pub 15 (2026) § 5 and the
 * W-2 instructions (wages count in the year they're paid: a bonus paid
 * with the last check before the job ends is that job's pay this year).
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { deduction, job } from "../fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import { yearEarnings } from "@/lib/pure/paycheck/person-paycheck";
import { yearTotals } from "@/lib/pure/paycheck/year-totals";

describe("answer key: the wage base on FICA wages", () => {
  it("paycheck/PAY16-P4 [PAY-16] § 125 money leaves the bonus room under the base", () => {
    // Single 2026, $187,200 biweekly ($7,200 a check), § 125 health $200
    // a check: FICA wages 7,000 × 26 = 182,000, under 184,500. A $10,000
    // undated bonus (after the regular checks): room 184,500 − 182,000 =
    // 2,500, SS 6.2% × 2,500 = 155.00; Medicare 1.45% × 10,000 = 145.00
    // (year Medicare wages 192,000 < 200,000: no surtax). FICA 300.00.
    // Judged on gross (187,200, past the base) the room would be 0.
    const b = calculatePaycheck(
      job({
        salary: 187_200,
        period: "biweekly",
        bonus: 10_000,
        deductions: [deduction("Health", 200, "pre_tax")],
      }),
    ).bonusEstimate;
    cents(b.bonusFica, 300);
  });
});

describe("answer key: a job's last check", () => {
  it("paycheck/PAY25-P6 [PAY-25] a bonus paid with the last check before the end date is this year's pay", () => {
    // Single 2026, $104,000 biweekly from Friday January 2 ($4,000 a
    // check); the job's last day is Friday June 5, check 12 (January 2 +
    // 11 × 14 days). A $10,000 bonus dated June 5 is paid with that check.
    // Year: 12 × 4,000 = 48,000 salary + 10,000 bonus = 58,000 gross.
    const input = job({
      salary: 104_000,
      period: "biweekly",
      bonus: 10_000,
      bonusMonth: 6,
      bonusDay: 5,
    });
    const paycheck = calculatePaycheck({
      ...input,
      endDate: new Date("2026-06-05T12:00:00Z"),
    });
    const { earnings } = yearEarnings(
      { id: 1, employerName: "Acme", startDate: "2026-01-02" },
      paycheck,
      26,
      104_000,
      [],
      [],
      () => ({
        endedJobs: [],
        endedYears: [],
        undatedBonusEmployers: [],
        endedWithheld: { federal: 0, fica: 0 },
      }),
      {},
    );
    cents(
      { salary: earnings.salary, bonus: earnings.bonus, gross: earnings.gross },
      { salary: 48_000, bonus: 10_000, gross: 58_000 },
    );
  });

  it("paycheck/PAY33-end [PAY-33] the Projected year of a job ending this year is its checks to its last day", () => {
    // The same job, no bonus: its last day Friday June 5 is check 12, so
    // its year is 12 × 4,000 = 48,000 gross, not 26 × 4,000 = 104,000 to
    // December 31. The Projected panel sums every row of the schedule.
    const paycheck = calculatePaycheck({
      ...job({ salary: 104_000, period: "biweekly" }),
      endDate: new Date("2026-06-05T12:00:00Z"),
    });
    const year = yearTotals(paycheck.yearSchedule, 1, 26);
    cents(year.gross, 48_000);
  });
});
