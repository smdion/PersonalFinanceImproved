/**
 * Answer key, the bonus check's Social Security and Medicare (PAY-16) and
 * its take-home (PAY-18), rows that had no case (v0.10.5 overnight
 * batch). Every expected figure is worked by hand from the publication
 * first, never read from `src/`; the shipped tables are only the input.
 * Invented households only.
 *
 * Rules: Pub 15 (2026) § 7 (supplemental wages, the flat 22%, method 1a)
 * and § 9 (Social Security 6.2% to the $184,500 wage base; Medicare
 * 1.45%; Additional Medicare withheld at 0.9% on wages an employer pays a
 * person past $200,000 in the calendar year, whatever the filing status);
 * IRC 3101(a), (b)(1), 3102(f), 3121(a)(1); IRC 3121(a)(5)(G) and 106(d)
 * (HSA money through a cafeteria plan isn't FICA wages), with the
 * self-only HSA limit $4,400 (Rev. Proc. 2025-19).
 *
 * The bonus below has no date, so it's paid after the year's 26 regular
 * checks (spec C48's convention): it gets the wage-base room regular pay
 * leaves, and regular pay never shares a check with it. A dated bonus's
 * split with a check is verdict N8's open question and isn't asserted.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { account, job } from "../fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import { bonusSpendingNet } from "@/lib/pure/household/household-income";

describe("answer key: the bonus check's FICA", () => {
  it("paycheck/PAY16-1 [PAY-16] Social Security only on the room regular pay leaves", () => {
    // Single 2026, $156,000 biweekly ($6,000 × 26 regular FICA wages =
    // 156,000), $40,000 bonus. Room 184,500 − 156,000 = 28,500: SS 6.2% ×
    // 28,500 = 1,767.00. Medicare 1.45% × 40,000 = 580.00. Year wages
    // 196,000 stay under 200,000: no Additional Medicare. FICA 2,347.00.
    const b = calculatePaycheck(
      job({ salary: 156_000, period: "biweekly", bonus: 40_000 }),
    ).bonusEstimate;
    cents(
      { fica: b.bonusFica, ficaWages: b.bonusFicaWages },
      { fica: 2_347, ficaWages: 40_000 },
    );
  });

  it("paycheck/PAY16-2 [PAY-16] an HSA the bonus check takes, inside its cap, isn't FICA wages", () => {
    // Single 2026, $52,000 biweekly, $10,000 bonus. Payroll HSA $100 a
    // check, also taken from the bonus check (a fixed amount: its $100),
    // FICA-exempt to the $4,400 self-only limit. Regular checks use 2,600
    // of it; the bonus's 100 fits in the 1,800 left. Bonus FICA wages
    // 10,000 − 100 = 9,900; room 184,500 − 52,000 − 2,600 is ample: SS
    // 6.2% × 9,900 = 613.80, Medicare 1.45% × 9,900 = 143.55; FICA 757.35.
    const b = calculatePaycheck(
      job({
        salary: 52_000,
        period: "biweekly",
        bonus: 10_000,
        accounts: [
          account({
            name: "HSA",
            perCheck: 100,
            checks: 26,
            treatment: "hsa",
            fromBonus: true,
            ficaExemptAnnualCap: 4_400,
          }),
        ],
      }),
    ).bonusEstimate;
    cents(
      { fica: b.bonusFica, ficaWages: b.bonusFicaWages },
      { fica: 757.35, ficaWages: 9_900 },
    );
  });

  // Single 2026, $208,000 biweekly ($8,000 a check), $10,000 bonus. Regular
  // pay alone uses the whole wage base (208,000 > 184,500): bonus SS 0.
  // Medicare 1.45% × 10,000 = 145.00. Regular pay already passed $200,000
  // with this employer (check 25), so the whole bonus is past it:
  // Additional Medicare withheld 0.9% × 10,000 = 90.00 (Pub 15 § 9,
  // 3102(f)). FICA 235.00. Federal 22% × 10,000 = 2,200.00. Net 10,000 −
  // 2,200 − 235 = 7,565.00.
  it("paycheck/PAY16-3 [PAY-16] past $200,000 with this employer, the bonus pays Additional Medicare", () => {
    const b = calculatePaycheck(
      job({ salary: 208_000, period: "biweekly", bonus: 10_000 }),
    ).bonusEstimate;
    cents({ fica: b.bonusFica, net: b.bonusNet }, { fica: 235, net: 7_565 });
  });
});

describe("answer key: the bonus's take-home", () => {
  it("paycheck/PAY18-1 [PAY-18] gross less the flat rate, FICA and what the check takes", () => {
    // PAY16-2's check: federal 22% × (10,000 − the HSA's 100, pre-tax) =
    // 2,178.00; FICA 757.35; the HSA 100. Net 10,000 − 2,178 − 757.35 −
    // 100 = 6,964.65.
    const b = calculatePaycheck(
      job({
        salary: 52_000,
        period: "biweekly",
        bonus: 10_000,
        accounts: [
          account({
            name: "HSA",
            perCheck: 100,
            checks: 26,
            treatment: "hsa",
            fromBonus: true,
            ficaExemptAnnualCap: 4_400,
          }),
        ],
      }),
    ).bonusEstimate;
    cents(
      {
        federal: b.bonusFederalWithholding,
        contributions: b.bonusContributions,
        net: b.bonusNet,
      },
      { federal: 2_178, contributions: 100, net: 6_964.65 },
    );
  });

  it("paycheck/PAY18-2 [PAY-18] bonus money set aside as spending: only the bonuses sent there", () => {
    // PAY16-1's bonus: 40,000 − 22% × 40,000 = 8,800 − FICA 2,347 =
    // 28,853.00, sent to spending; a second person's 5,000 net bonus stays
    // in the budget. Spending: 28,853.00.
    const b = calculatePaycheck(
      job({ salary: 156_000, period: "biweekly", bonus: 40_000 }),
    ).bonusEstimate;
    cents(
      {
        net: b.bonusNet,
        spending: bonusSpendingNet([
          { netBonus: b.bonusNet, bonusDestination: "spending" },
          { netBonus: 5_000, bonusDestination: "budget" },
        ]),
      },
      { net: 28_853, spending: 28_853 },
    );
  });
});
