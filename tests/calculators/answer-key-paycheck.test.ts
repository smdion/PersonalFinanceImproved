/**
 * Answer key, paycheck (calculator level): figures worked by hand from the
 * published rules, each with its working and citation beside it. Source of
 * the cases: the November review's paycheck spec (`specs/paycheck.md`
 * Worked examples, C-ids kept), its verdicts
 * (`rebuild/paycheck-verdicts.md` § "Cases ready to become permanent
 * tests") and the CPA hand worksheet (`hand-worksheet.md` H1–H4, with
 * `comparison.md`), as collected in the draft answer key
 * (`.scratch/docs/drafts/answer-key.md` § Paycheck). The bracketed part of
 * each title is the docs/CALCULATIONS.md row.
 *
 * Tables: the shipped `tax-data/us-federal/<year>.json` (read through
 * `tests/helpers/tax-data.ts`), Pub 15-T's percentage method tables
 * (T25, T26: § 1 Worksheet 1A and the Annual Percentage Method tables,
 * p. 12 in 2026). Every withholding figure below is worked by hand on
 * Worksheet 1A with the published columns A, C and D, never read from
 * those tables or from `src/`:
 *
 *   1a wages for the period; 1b P (Table 3: 52, 26, 24, 12); 1c = 1a × P;
 *   1g $12,900 MFJ, $8,600 everyone else, $0 with the Step 2(c) box (T25
 *   and T26 line 1g); 1i/2a = max(0, 1c − 1g); 2b–2f the row with
 *   A ≤ 2a < B, its C and D; 2g = C + (2a − A) × D; 2h = 2g / P. No Step 3
 *   or 4 entries, so 2h is the withholding (lines 3c, 4b).
 *
 * FICA: 6.2% to the wage base, $184,500 in 2026 and $176,100 in 2025 (Pub
 * 15 (2026) § 9; IRC 3101(a), 3121(a)(1)); 1.45% Medicare (3101(b)(1));
 * Additional Medicare withheld at 0.9% on this employer's wages past
 * $200,000 (3102(f)). Supplemental wages at the flat 22% (Pub 15 § 7,
 * method 1a). Rounding: each line of a check to the cent; annual sums of
 * per-check lines may differ from the closed form by ±$0.01 a check (spec
 * PW-3.15).
 *
 * Not written here, on purpose:
 * - C01, C02 (Pub 15 § 7 Ex. 1, a pre-2020 W-4 with allowances): Ledgr
 *   has no allowance field; decided 2026-11-02 to disclose, v0.12 UI
 *   "Disclosure list additions".
 * - C03, C05 (the aggregate method): Ledgr withholds bonuses at the flat
 *   rate only (U5); closed, v0.12 UI "Disclosure list additions".
 * - C18, HW-H2b, C52, C53: blocked, below as `it.todo`.
 * - C48's bonus-check split (a $20,000 bonus after regular pay used the
 *   whole base): written below as an expected failure on its year totals
 *   only (owner, 2026-11-03). The bonus's own FICA and net (spec 380.00
 *   and 15,220.00, today 290.00 and 15,310.00) wait on an N8 ruling: a
 *   bonus dated onto check 26 shares that check's last 1,807.75 of base
 *   pro rata.
 * - The December per-check split of C47 (spec $372 / $1,767, Ledgr
 *   $279 / $1,860 pro rata): verdict N8 calls it an app definition the
 *   owner hasn't recorded, so only the year totals and January are held.
 */
import { describe, expect, it } from "vitest";
import { cents, xfail } from "../fixtures/answer-key";
import {
  account,
  deduction,
  job,
  liabilityInput,
  limit,
} from "../pure/fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/calculators/paycheck";
import { calculateHouseholdTax } from "@/lib/calculators/tax";
import { computeAnnualEarnings } from "@/lib/pure/household-income";
import type {
  PaycheckInput,
  PaycheckResult,
} from "@/lib/pure/types/calculators";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

const row = (r: PaycheckResult, check: number) => r.yearSchedule[check - 1]!;
const sum = (xs: number[]) =>
  Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

/** The year's take-home over the schedule, the bonus row included
 *  (PW-9.5): each check's net plus the bonus less its own withholding. */
function scheduleNet(r: PaycheckResult): number {
  return sum(
    r.yearSchedule.map(
      (p) => p.netPay + p.bonusGross - p.bonusWithholding - p.bonusFica,
    ),
  );
}

// ── Pub 15 § 7: the publication's own example ───────────────────────────

describe("paycheck/C04: the flat supplemental rate", () => {
  it("paycheck/C04 [PAY-15] a $1,000 bonus at 22%, whatever the W-4 says", () => {
    // Pub 15 (2026) § 7 Example 3: monthly $2,000, Single W-4; a $1,000
    // bonus by method 1a: 22% × 1,000 = 220.00. The regular entries
    // aren't used.
    const r = calculatePaycheck(
      job({ salary: 24_000, period: "monthly", bonus: 1_000 }),
    );
    cents(r.bonusEstimate.bonusFederalWithholding, 220);
  });
});

// ── Worksheet 1A at every period and status (spec C16–C30) ─────────────

describe("paycheck/C16–C30: Worksheet 1A", () => {
  it("paycheck/C16 [PAY-06] Single, biweekly, 2026", () => {
    // 1a 2,500; 1c 2,500 × 26 = 65,000; 1g 8,600; 2a 56,400.
    // T26 Single standard row A 19,900, C 1,240, D 12%:
    // 2g 1,240 + 12% × 36,500 = 5,620.00; 2h 5,620 / 26 = 216.1538.
    const r = calculatePaycheck(job({ salary: 65_000, period: "biweekly" }));
    cents(r.federalWithholding, 216.15);
  });

  it("paycheck/C17 [PAY-06] MFJ, monthly", () => {
    // 1a 10,000; 1c × 12 = 120,000; 1g 12,900; 2a 107,100.
    // T26 MFJ standard row A 44,100, C 2,480, D 12%:
    // 2g 2,480 + 12% × 63,000 = 10,040.00; 2h / 12 = 836.6667.
    const r = calculatePaycheck(
      job({ salary: 120_000, period: "monthly", status: "MFJ" }),
    );
    cents(r.federalWithholding, 836.67);
  });

  it("paycheck/C19 [PAY-09] Single, biweekly, the Step 2(c) box picks the table", () => {
    // Standard: 1c 3,000 × 26 = 78,000; 1g 8,600; 2a 69,400; T26 Single
    // standard row A 57,900, C 5,800, D 22%: 2g 5,800 + 22% × 11,500 =
    // 8,330.00; 2h / 26 = 320.3846.
    // Checked: 1g 0; 2a 78,000; T26 Single checkbox row A 60,900, C 8,983,
    // D 24%: 2g 8,983 + 24% × 17,100 = 13,087.00; 2h / 26 = 503.3462.
    const standard = calculatePaycheck(
      job({ salary: 78_000, period: "biweekly" }),
    );
    const checked = calculatePaycheck(
      job({ salary: 78_000, period: "biweekly", checkbox: true }),
    );
    cents(standard.federalWithholding, 320.38);
    cents(checked.federalWithholding, 503.35);
  });

  it("paycheck/C20 [PAY-06] MFJ, weekly, Step 2(c)", () => {
    // 1a 1,800; 1c × 52 = 93,600; 1g 0; 2a 93,600. T26 MFJ checkbox row
    // A 66,500, C 5,800, D 22%: 2g 5,800 + 22% × 27,100 = 11,762.00;
    // 2h / 52 = 226.1923.
    const r = calculatePaycheck(
      job({
        salary: 93_600,
        period: "weekly",
        status: "MFJ",
        checkbox: true,
      }),
    );
    cents(r.federalWithholding, 226.19);
  });

  it("paycheck/C21 [PAY-07] HOH, biweekly, Step 2(c): no line 1g on the checkbox table", () => {
    // 1a 2,000; 1c × 26 = 52,000; 1g 0; 2a 52,000. T26 HOH checkbox row
    // A 45,800, C 3,870, D 22%: 2g 3,870 + 22% × 6,200 = 5,234.00;
    // 2h / 26 = 201.3077.
    const r = calculatePaycheck(
      job({
        salary: 52_000,
        period: "biweekly",
        status: "HOH",
        checkbox: true,
      }),
    );
    cents(r.federalWithholding, 201.31);
  });

  it("paycheck/C27 [PAY-06] MFJ, biweekly, the top rate", () => {
    // 1a 40,000; 1c × 26 = 1,040,000; 1g 12,900; 2a 1,027,100. T26 MFJ
    // standard top row A 788,000, C 206,583.50, D 37%:
    // 2g 206,583.50 + 37% × 239,100 = 295,050.50; 2h / 26 = 11,348.0962.
    const r = calculatePaycheck(
      job({ salary: 1_040_000, period: "biweekly", status: "MFJ" }),
    );
    cents(r.federalWithholding, 11_348.1);
  });

  it("paycheck/C30 [PAY-06] the payment year picks the table", () => {
    // $2,500 biweekly, Single. 1c 65,000; 1g 8,600 (both years); 2a 56,400.
    // T25 Single standard row A 54,875, C 5,578.50, D 22%:
    //   2g 5,578.50 + 22% × 1,525 = 5,914.00; 2h / 26 = 227.4615.
    // T26 row A 19,900, C 1,240, D 12%: 2g 5,620.00; 2h 216.1538 (paycheck/C16).
    const paid2025 = calculatePaycheck(
      job({ salary: 65_000, period: "biweekly", year: 2025 }),
    );
    const paid2026 = calculatePaycheck(
      job({ salary: 65_000, period: "biweekly" }),
    );
    cents(paid2025.federalWithholding, 227.46);
    cents(paid2026.federalWithholding, 216.15);
  });
});

// ── A full stub (spec C37, C62) ─────────────────────────────────────────

describe("paycheck/C37, C62: what each tax treats as wages", () => {
  it("paycheck/C37 [PAY-13] every deduction type on one check", () => {
    // $6,000 biweekly, MFJ, Step 2(c) box checked. Traditional 401(k) 360,
    // Roth 401(k) 100, § 125 health 150, § 125 HSA 200, commuter 50,
    // after-tax disability 20 (spec PW-4.1 matrix).
    // Income-tax wages 6,000 − 360 − 150 − 200 − 50 = 5,240 (Roth and
    // after-tax stay in, PW-4.3, PW-4.15). FICA wages 6,000 − 150 − 200 −
    // 50 = 5,600 (the 401(k) and Roth stay in, PW-4.2).
    // Worksheet 1A: 1c 5,240 × 26 = 136,240; 1g 0; T26 MFJ checkbox row
    // A 121,800, C 17,966, D 24%: 2g 17,966 + 24% × 14,440 = 21,431.60;
    // 2h / 26 = 824.2923. SS 6.2% × 5,600 = 347.20; Medicare 1.45% =
    // 81.20. Net 6,000 − 880 deductions − 824.29 − 347.20 − 81.20 =
    // 3,867.31.
    const r = calculatePaycheck(
      job({
        salary: 156_000,
        period: "biweekly",
        status: "MFJ",
        checkbox: true,
        accounts: [
          account({
            name: "401(k)",
            perCheck: 360,
            checks: 26,
            treatment: "pre_tax",
          }),
          account({
            name: "Roth 401(k)",
            perCheck: 100,
            checks: 26,
            treatment: "tax_free",
          }),
          account({
            name: "HSA",
            perCheck: 200,
            checks: 26,
            treatment: "hsa",
            // The 2026 family limit (8,750), no employer money: 5,200 a
            // year fits under it, so all of it is outside FICA (PW-4.6).
            ficaExemptAnnualCap: 8_750,
          }),
        ],
        deductions: [
          deduction("Health", 150, "pre_tax"),
          deduction("Commuter", 50, "pre_tax"),
          deduction("Disability", 20, "after_tax"),
        ],
      }),
    );
    cents(
      {
        federal: r.federalWithholding,
        ficaWages: r.ficaWages,
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      {
        federal: 824.29,
        ficaWages: 5_600,
        ss: 347.2,
        medicare: 81.2,
        net: 3_867.31,
      },
    );
  });

  it("paycheck/C62 [PAY-04] Roth against traditional, same gross", () => {
    // $5,000 biweekly Single, $500 deferred.
    // Traditional: income-tax wages 4,500; 1c 117,000; 1g 8,600; 2a
    //   108,400; T26 Single row A 57,900, C 5,800, D 22%: 2g 5,800 + 22% ×
    //   50,500 = 16,910.00; 2h / 26 = 650.3846.
    // Roth: wages 5,000; 1c 130,000; 2a 121,400; row A 113,200, C 17,966,
    //   D 24%: 2g 17,966 + 24% × 8,200 = 19,934.00; 2h / 26 = 766.6923.
    // FICA on 5,000 either way (PW-4.2, PW-4.3): SS 310.00, Medicare 72.50.
    const deferral = (treatment: "pre_tax" | "tax_free") =>
      calculatePaycheck(
        job({
          salary: 130_000,
          period: "biweekly",
          accounts: [
            account({ name: "401(k)", perCheck: 500, checks: 26, treatment }),
          ],
        }),
      );
    const traditional = deferral("pre_tax");
    const roth = deferral("tax_free");
    cents(traditional.federalWithholding, 650.38);
    cents(roth.federalWithholding, 766.69);
    for (const r of [traditional, roth])
      cents(
        { ss: r.ficaSS, medicare: r.ficaMedicare },
        { ss: 310, medicare: 72.5 },
      );
  });
});

// ── Social Security and Additional Medicare in pay-date order ───────────

describe("paycheck/C38–C51: wage bases on the year schedule", () => {
  it("paycheck/C38 [PAY-19] the Social Security base is crossed inside a check", () => {
    // $390,000, $15,000 biweekly, 2026, one employer. After 12 checks YTD
    // 180,000: check 12 is 6.2% × 15,000 = 930.00. Check 13 has 184,500 −
    // 180,000 = 4,500 of room: 279.00. Check 14 on: none. Year 6.2% ×
    // 184,500 = 11,439.00 (PW-6.2, PW-6.8; IRC 3121(a)(1)).
    const r = calculatePaycheck(job({ salary: 390_000, period: "biweekly" }));
    cents(row(r, 12).ficaSS, 930);
    cents(row(r, 13).ficaSS, 279);
    cents(row(r, 14).ficaSS, 0);
    cents(sum(r.yearSchedule.map((p) => p.ficaSS)), 11_439);
  });

  it("paycheck/C40 [PAY-10] the 2025 base", () => {
    // Paid in 2025, $200,000 in the year (26 checks of 7,692.31), one
    // employer: 6.2% × 176,100 (the 2025 base, Pub 15 (2025) § 9) =
    // 10,918.20. Ledgr's checks are whole cents (26 × 7,692.31 =
    // 200,000.06) and its crossing check is figured on them: 10,918.13,
    // within ±$0.10 (the key's tolerance for this case).
    const r = calculatePaycheck(
      job({ salary: 200_000, period: "biweekly", year: 2025 }),
    );
    cents(sum(r.yearSchedule.map((p) => p.ficaSS)), 10_918.2, 0.1);
  });

  it("paycheck/C43 [PAY-12] Additional Medicare starts in the crossing check", () => {
    // $390,000, $15,000 biweekly, 2026. After 13 checks YTD 195,000: none.
    // Check 14 takes YTD to 210,000, 10,000 over: 0.9% × 10,000 = 90.00.
    // Check 15 on: 0.9% × 15,000 = 135.00. Year 0.9% × (390,000 −
    // 200,000) = 1,710.00 (PW-7.1, PW-7.9; IRC 3102(f)). Medicare 1.45% ×
    // 15,000 = 217.50 on every check.
    const r = calculatePaycheck(job({ salary: 390_000, period: "biweekly" }));
    const additional = (check: number) => row(r, check).ficaMedicare - 217.5;
    cents(additional(13), 0);
    cents(additional(14), 90);
    cents(additional(15), 135);
    cents(sum(r.yearSchedule.map((p) => p.ficaMedicare - 217.5)), 1_710);
  });

  it("paycheck/C47 [PAY-19] the bonus's date doesn't change the year", () => {
    // $156,000, $6,000 biweekly, $40,000 bonus at 22%, Single 2026, 26
    // checks (PW-8.1, PW-8.2). The bonus is paid with check 1 (January 2)
    // or with check 26 (December 18).
    // Year Social Security 6.2% × min(196,000, 184,500) = 11,439.00 both
    // ways (PW-6.8). January: the bonus check's room is the whole bonus,
    // 6.2% × 40,000 = 2,480.00, plus Medicare 1.45% × 40,000 = 580.00, so
    // the bonus's FICA is 3,060.00; 24 checks are taxed in full, check 25
    // on 184,500 − 40,000 − 24 × 6,000 = 500, check 26 none. Federal on
    // the bonus 22% × 40,000 = 8,800.00.
    // Year net: 196,000 − regular federal 26,174.00 (1c 156,000; 1g 8,600;
    // 2a 147,400; T26 Single row A 113,200, C 17,966, D 24%: 2g 17,966 +
    // 24% × 34,200 = 26,174.00) − 8,800 − 11,439 − Medicare 1.45% ×
    // 196,000 = 2,842 = 146,745.00, ±$0.26 for 26 checks' rounding
    // (PW-3.15), and the same both ways (PW-8.2).
    // The December split (which check bears the SS) isn't asserted:
    // verdict N8.
    const run = (bonusMonth: number, bonusDay: number) =>
      calculatePaycheck(
        job({
          salary: 156_000,
          period: "biweekly",
          bonus: 40_000,
          bonusMonth,
          bonusDay,
        }),
      );
    const january = run(1, 2);
    const december = run(12, 18);
    // The bonus's SS is its FICA less its Medicare.
    const yearSS = (r: PaycheckResult) =>
      sum(
        r.yearSchedule.map(
          (p) => p.ficaSS + (p.bonusGross > 0 ? p.bonusFica - 580 : 0),
        ),
      );
    expect(january.bonusPeriod).toBe(1);
    expect(december.bonusPeriod).toBe(26);
    cents(yearSS(january), 11_439);
    cents(yearSS(december), 11_439);
    cents(
      {
        bonusFica: row(january, 1).bonusFica,
        bonusFederal: row(january, 1).bonusWithholding,
        check26SS: row(january, 26).ficaSS,
        check25SS: row(january, 25).ficaSS,
      },
      { bonusFica: 3_060, bonusFederal: 8_800, check26SS: 0, check25SS: 31 },
    );
    cents(scheduleNet(january), 146_745, 0.26);
    cents(scheduleNet(january), scheduleNet(december));
  });

  // C48: regular pay alone uses the whole base, then a $20,000 bonus with
  // no date (spec: paid after check 26). $190,000, 26 biweekly checks of
  // 7,307.69 (= 189,999.94), Single 2026. Year wages 209,999.94.
  // Closed form (PW-6.8, PW-7.9):
  //   SS 6.2% × min(209,999.94, 184,500) = 11,439.00 (IRC 3101(a),
  //     3121(a)(1); Pub 15 (2026) § 9);
  //   Medicare 1.45% × 209,999.94 = 3,045.00 (3101(b)(1));
  //   Additional Medicare 0.9% × (209,999.94 − 200,000) = 90.00, all on
  //     the bonus: regular pay never passes $200,000 (3102(f) withholding;
  //     3101(b)(2) liability, Single threshold also $200,000);
  //   FICA 14,574.00.
  // Federal: regular 1c 189,999.94; 1g 8,600; 2a 181,399.94; T26 Single
  //   standard row A 113,200, C 17,966, D 24%: 2g 17,966 + 24% × 68,199.94
  //   = 34,333.99; bonus 22% × 20,000 = 4,400.00 (Pub 15 § 7, 1a).
  // Year net 209,999.94 − 34,333.99 − 4,400 − 14,574.00 = 156,691.95,
  //   ±$0.26 for 26 checks' rounding (PW-3.15).
  // Today the undated bonus isn't on the schedule; its estimate charges
  // Medicare 290.00 and no Additional Medicare (bonus net 15,310.00, spec
  // 15,220.00), so the year is 90.00 short: FICA 14,484.00, net
  // 156,781.95. The bonus's own split isn't asserted (verdict N8).
  xfail({
    id: "paycheck/C48 [PAY-19]",
    todo: 'v0.11 Paycheck "Take-home, wider than reported"',
    run: () => {
      const r = calculatePaycheck(
        job({ salary: 190_000, period: "biweekly", bonus: 20_000 }),
      );
      // The bonus is counted once: from its schedule row once it has one,
      // from the estimate while it's undated and off the schedule.
      const onSchedule = r.yearSchedule.some((p) => p.bonusGross > 0);
      const b = r.bonusEstimate;
      return {
        fica:
          sum(
            r.yearSchedule.map((p) => p.ficaSS + p.ficaMedicare + p.bonusFica),
          ) + (onSchedule ? 0 : b.bonusFica),
        net: scheduleNet(r) + (onSchedule ? 0 : b.bonusNet),
      };
    },
    expected: { fica: 14_574, net: 156_691.95 },
    today: { fica: 14_484, net: 156_781.95 },
    tolerance: 0.26,
  });

  it("paycheck/C51 [PAY-17] the bonus's 401(k) comes off before the flat rate", () => {
    // Bonus $10,000 with a 10% traditional 401(k) election on it, flat
    // 22%, YTD low ($52,000 salary). The deferral of 1,000 isn't income-tax
    // wages, so the flat base is 9,000: 1,980.00. FICA on the whole 10,000
    // (PW-8.8): SS 620.00, Medicare 145.00. Net 10,000 − 1,000 − 1,980 −
    // 765 = 6,255.00.
    const r = calculatePaycheck(
      job({
        salary: 52_000,
        period: "biweekly",
        bonus: 10_000,
        accounts: [
          account({
            name: "401(k)",
            perCheck: 200,
            checks: 26,
            treatment: "pre_tax",
            rateOfGross: 0.1,
            fromBonus: true,
          }),
        ],
      }),
    );
    const b = r.bonusEstimate;
    cents(
      {
        federal: b.bonusFederalWithholding,
        fica: b.bonusFica,
        contributions: b.bonusContributions,
        net: b.bonusNet,
      },
      { federal: 1_980, fica: 765, contributions: 1_000, net: 6_255 },
    );
  });
});

// ── The CPA hand worksheet (hand-worksheet.md H1–H4) ────────────────────

/** The year's earnings and 2026 liability for one job (the Taxes page's
 *  path: computeAnnualEarnings, then calculateHouseholdTax). */
function yearOf(
  input: PaycheckInput,
  r: PaycheckResult,
  status: ReturnFilingStatus,
) {
  const earnings = computeAnnualEarnings({
    salary: input.annualSalary,
    periodsPerYear: r.periodsPerYear,
    paycheck: r,
    contributionAccounts: input.contributionAccounts,
    deductions: input.deductions,
  });
  const tax = calculateHouseholdTax({
    people: [earnings],
    taxBrackets: liabilityInput(status),
    medicareLiabilityThreshold: limit(
      2026,
      `fica_medicare_surtax_liability_${status.toLowerCase()}`,
    ),
  });
  return { earnings, tax };
}

describe("paycheck/HW-H1–H4: the CPA hand worksheet", () => {
  it("paycheck/HW-H1 [PAY-13] Single, biweekly, Roth 401(k) and § 125 health", () => {
    // Single, 26 (born 2000), $58,000 biweekly, W-4 Single. Roth 401(k) 6%
    // (58,000 × 6% / 26 = 133.85 a check), § 125 health 60 a check.
    // Check: gross 58,000 / 26 = 2,230.77; wages 2,230.77 − 60 = 2,170.77.
    // Worksheet 1A: 1c × 26 = 56,440.02; 1g 8,600; 2a 47,840.02; T26
    // Single row A 19,900, C 1,240, D 12%: 2g 1,240 + 12% × 27,940.02 =
    // 4,592.80; 2h / 26 = 176.65. SS 6.2% × 2,170.77 = 134.59; Medicare
    // 1.45% = 31.48. Net 2,230.77 − 60 − 133.85 − 176.65 − 134.59 − 31.48
    // = 1,694.20 by rounded lines, 1,694.21 from the unrounded ones (the
    // worksheet's figure; ±$0.01, PW-3.15).
    // Year: box 1 58,000 − 1,560 = 56,440; TI 56,440 − 16,100 = 40,340;
    // RP25 Single schedule 1,240 + 12% × (40,340 − 12,400) = 4,592.80; SS
    // 6.2% × 56,440 = 3,499.28; Medicare 1.45% = 818.38.
    const input = job({
      salary: 58_000,
      period: "biweekly",
      accounts: [
        account({
          name: "Roth 401(k)",
          perCheck: 133.85,
          checks: 26,
          treatment: "tax_free",
          rateOfGross: 0.06,
        }),
      ],
      deductions: [deduction("Health", 60, "pre_tax")],
    });
    const r = calculatePaycheck(input);
    cents(
      {
        gross: r.gross,
        federal: r.federalWithholding,
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      {
        gross: 2_230.77,
        federal: 176.65,
        ss: 134.59,
        medicare: 31.48,
        net: 1_694.21,
      },
      0.01,
    );
    const { earnings, tax } = yearOf(input, r, "Single");
    cents(earnings.federalWages, 56_440, 0.01);
    cents(
      {
        ti: tax.taxableIncome,
        tax: tax.federalTax,
        ss: tax.ficaSS,
        medicare: tax.ficaMedicare,
      },
      { ti: 40_340, tax: 4_592.8, ss: 3_499.28, medicare: 818.38 },
      0.01,
    );
  });

  it("paycheck/HW-H2a [PAY-13] HOH, semimonthly, no Step 3", () => {
    // HOH, 38, $72,000 semimonthly: gross 3,000. Traditional 401(k) 5% =
    // 150 a check, § 125 health 120. Wages 3,000 − 270 = 2,730.
    // Worksheet 1A: 1c × 24 = 65,520; 1g 8,600; 2a 56,920; T26 HOH row
    // A 33,250, C 1,770, D 12%: 2g 1,770 + 12% × 23,670 = 4,610.40; 2h /
    // 24 = 192.10. FICA wages 2,880: SS 178.56, Medicare 41.76. Net
    // 3,000 − 270 − 192.10 − 178.56 − 41.76 = 2,317.58.
    // Year: box 1 65,520; TI 65,520 − 24,150 = 41,370; RP25 HOH schedule
    // 1,770 + 12% × (41,370 − 17,700) = 4,610.40 before credits.
    const input = job({
      salary: 72_000,
      period: "semimonthly",
      status: "HOH",
      accounts: [
        account({
          name: "401(k)",
          perCheck: 150,
          checks: 24,
          treatment: "pre_tax",
          rateOfGross: 0.05,
        }),
      ],
      deductions: [deduction("Health", 120, "pre_tax")],
    });
    const r = calculatePaycheck(input);
    cents(
      { federal: r.federalWithholding, net: r.netPay },
      { federal: 192.1, net: 2_317.58 },
    );
    const { tax } = yearOf(input, r, "HOH");
    cents(
      { ti: tax.taxableIncome, tax: tax.federalTax },
      { ti: 41_370, tax: 4_610.4 },
    );
  });

  it("paycheck/HW-H3 [PAY-25] one earner, a March bonus, HSA family", () => {
    // MFJ, 45 and 44, $140,000 biweekly: gross 5,384.62. 15% bonus
    // (21,000) in March. Traditional 401(k) 10% incl. the bonus check
    // (538.46 a check), HSA family 300 a check plus 950 employer, § 125
    // health 200.
    // Check: wages 5,384.62 − 200 − 538.46 − 300 = 4,346.16. Worksheet 1A:
    // 1c × 26 = 113,000.16; 1g 12,900; 2a 100,100.16; T26 MFJ row A 44,100,
    // C 2,480, D 12%: 2g 2,480 + 12% × 56,000.16 = 9,200.02; 2h / 26 =
    // 353.85. FICA wages 5,384.62 − 500 = 4,884.62: SS 302.85, Medicare
    // 70.83. Net 3,618.64 from the unrounded lines (3,618.63 by rounded
    // ones; ±$0.01, PW-3.15).
    // Bonus: 401(k) 2,100; 22% × 18,900 = 4,158.00; SS 6.2% × 21,000 =
    // 1,302.00 and Medicare 304.50 (FICA 1,606.50); net 21,000 − 2,100 −
    // 4,158 − 1,606.50 = 13,135.50.
    // Year: box 1 161,000 − 14,000 − 2,100 − 7,800 − 5,200 = 131,900; TI
    // − 32,200 = 99,700; RP25 MFJ 2,480 + 12% × (99,700 − 24,800) =
    // 11,468.00; SS 6.2% × FICA wages 148,000 = 9,176.00 (Ledgr's checks
    // sum to 148,000.12: ±$0.01). HSA 7,800 + 950 = 8,750, the family
    // limit exactly (cap for payroll money 8,750 − 950 = 7,800).
    const input = job({
      salary: 140_000,
      period: "biweekly",
      status: "MFJ",
      bonusPercent: 0.15,
      bonusMonth: 3,
      bonusDay: 15,
      accounts: [
        account({
          name: "401(k)",
          perCheck: 538.46,
          checks: 26,
          treatment: "pre_tax",
          rateOfGross: 0.1,
          fromBonus: true,
          annual: 14_000,
        }),
        account({
          name: "HSA",
          perCheck: 300,
          checks: 26,
          treatment: "hsa",
          ficaExemptAnnualCap: 7_800,
          employerMatch: 950,
        }),
      ],
      deductions: [deduction("Health", 200, "pre_tax")],
    });
    const r = calculatePaycheck(input);
    cents(
      {
        federal: r.federalWithholding,
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      { federal: 353.85, ss: 302.85, medicare: 70.83, net: 3_618.64 },
    );
    cents(
      {
        bonusFederal: r.bonusEstimate.bonusFederalWithholding,
        bonusFica: r.bonusEstimate.bonusFica,
        bonusNet: r.bonusEstimate.bonusNet,
      },
      { bonusFederal: 4_158, bonusFica: 1_606.5, bonusNet: 13_135.5 },
    );
    const { earnings, tax } = yearOf(input, r, "MFJ");
    cents(earnings.federalWages, 131_900, 0.01);
    cents(tax.federalTax, 11_468, 0.01);
    cents(tax.ficaSS, 9_176, 0.01);
  });

  it("paycheck/HW-H4 [PAY-06] two concurrent jobs sharing one 402(g) limit", () => {
    // Single, 33. Job A $120,000 biweekly, job B $90,000 monthly, Step 2(c)
    // checked on both. 401(k) A 15,000, B 12,000 asked; the shared 402(g)
    // 24,500 cuts both by 24,500 / 27,000: A 13,611.11 (523.50 a check),
    // B 10,888.89 (907.41 a check). The cap pass is the limits area's;
    // here the capped amounts are the input.
    // A: 1c (4,615.38 − 523.50) × 26 = 106,388.88; T26 Single checkbox row
    //   A 60,900, C 8,983, D 24%: 2g 8,983 + 24% × 45,488.88 = 19,900.33.
    // B: 1c (7,500 − 907.41) × 12 = 79,111.08; same row: 13,353.66.
    // Year withholding 33,254 (the worksheet, on unrounded deferrals),
    // ±$0.38 for the 38 checks' rounding (PW-3.15).
    // SS withheld: A 26 × 6.2% × 4,615.38 = 26 × 286.15 = 7,439.90; B 12
    // × 465.00 = 5,580; 13,020 (±$0.10). The liability is one person's:
    // 6.2% × 184,500 = 11,439. Medicare 1.45% × 209,999.88 = 3,045.00;
    // Additional Medicare owed 0.9% × 9,999.88 = 90.00, none withheld (each
    // job under 200,000). Box 1 210,000 − 24,500 = 185,500 (±$0.12).
    const jobA = job({
      salary: 120_000,
      period: "biweekly",
      checkbox: true,
      accounts: [
        account({
          name: "401(k) A",
          perCheck: 523.5,
          checks: 26,
          treatment: "pre_tax",
        }),
      ],
    });
    const jobB = job({
      salary: 90_000,
      period: "monthly",
      checkbox: true,
      accounts: [
        account({
          name: "401(k) B",
          perCheck: 907.41,
          checks: 12,
          treatment: "pre_tax",
        }),
      ],
    });
    const a = calculatePaycheck(jobA);
    const b = calculatePaycheck(jobB);
    cents(a.federalWithholding * 26 + b.federalWithholding * 12, 33_254, 0.38);
    cents(
      sum([...a.yearSchedule, ...b.yearSchedule].map((p) => p.ficaSS)),
      13_020,
      0.1,
    );
    const ea = yearOf(jobA, a, "Single").earnings;
    const eb = yearOf(jobB, b, "Single").earnings;
    const tax = calculateHouseholdTax({
      people: [
        {
          federalWages: ea.federalWages + eb.federalWages,
          ficaWages: ea.ficaWages + eb.ficaWages,
        },
      ],
      taxBrackets: liabilityInput("Single"),
      medicareLiabilityThreshold: limit(
        2026,
        "fica_medicare_surtax_liability_single",
      ),
    });
    cents(tax.wageAgi, 185_500, 0.12);
    cents(
      {
        ss: tax.ficaSS,
        medicare: tax.ficaMedicare,
        additional: tax.additionalMedicare,
      },
      { ss: 11_439, medicare: 3_135, additional: 90 },
    );
  });
});

// ── Blocked: an input Ledgr can't take yet ──────────────────────────────

describe("paycheck: blocked cases", () => {
  it.todo(
    'paycheck/C18: blocked on v0.11 Paycheck "No W-4 Step 3 / 4(a) / 4(b) input" (HOH semimonthly $4,000, Step 3 $4,400: spec 179.50)',
  );
  it.todo(
    'paycheck/HW-H2b: blocked on v0.11 Paycheck "No W-4 Step 3 / 4(a) / 4(b) input" (HOH, Step 3 $2,200: federal 100.43, net 2,409.25)',
  );
  it.todo(
    'paycheck/C52: blocked on v0.11 Paycheck "37% supplemental over $1M" (needs earlier supplemental wages this year, $900,000)',
  );
  it.todo(
    'paycheck/C53: blocked on v0.11 Paycheck "37% supplemental over $1M" (needs earlier supplemental wages this year, exactly $1,000,000)',
  );
});
