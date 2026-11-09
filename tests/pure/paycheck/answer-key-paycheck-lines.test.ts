/**
 * Answer key, paycheck lines (v0.10.5 overnight batch): other pay, cash
 * or imputed, and the taxes each is subject to (PAY-02); deductions
 * sorted by tax treatment (PAY-03); Medicare per check (PAY-11). Worked by
 * hand from the publications first, never read from `src/`. Invented jobs
 * only.
 *
 * Citations: Pub 15-B (2026) § 2 (group-term life over $50,000: its cost
 * is wages for income tax and for Social Security and Medicare; income
 * tax withholding on it is optional, and Ledgr withholds, which the
 * publication allows) and § 1 (a cash allowance is wages); Pub 15 (2026)
 * § 5 (wages); IRC 125 and 3121(a)(5)(G) (cafeteria-plan health money is
 * out of income-tax and FICA wages); 132(f) (qualified transportation,
 * likewise); 402A (Roth deferrals are taxed now); 3101(b)(1) (Medicare
 * 1.45%, no base). Withholding on Pub 15-T (2026) Worksheet 1A, as
 * written out in `answer-key-paycheck.test.ts`: Single standard row A
 * 19,900, C 1,240, D 12%; line 1g $8,600.
 */
import { describe, expect, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { deduction, job } from "../fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";
import {
  deductionLine,
  earningLines,
} from "@/lib/pure/paycheck/paycheck-lines";
import { isPreTax } from "@/lib/pure/paycheck/taxable-wages";

describe("answer key: other pay on the check", () => {
  it("paycheck/PAY02-1 [PAY-02] imputed group-term life: taxed, never paid", () => {
    // Single 2026, $52,000 biweekly ($2,000 a check), $20 a check of
    // group-term life cost over $50,000 (imputed). Income-tax and FICA
    // wages 2,020; take-home is figured on the 2,000 actually paid.
    // Worksheet 1A: 1c 2,020 × 26 = 52,520; 2a 52,520 − 8,600 = 43,920;
    // 2g 1,240 + 12% × 24,020 = 4,122.40; 2h / 26 = 158.55. SS 6.2% ×
    // 2,020 = 125.24; Medicare 1.45% × 2,020 = 29.29. Net 2,000 − 158.55
    // − 125.24 − 29.29 = 1,686.92.
    const r = calculatePaycheck({
      ...job({ salary: 52_000, period: "biweekly" }),
      earnings: [
        {
          name: "Group-term life",
          amount: 20,
          isCash: false,
          federalTaxable: true,
          ficaTaxable: true,
        },
      ],
    });
    cents(
      {
        federal: r.federalWithholding,
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      { federal: 158.55, ss: 125.24, medicare: 29.29, net: 1_686.92 },
      0.01,
    );
  });

  it("paycheck/PAY02-2 [PAY-02] a cash stipend: paid and taxed", () => {
    // The same job with a $100 cash stipend a check: wages 2,100, all of
    // it paid. 1c 54,600; 2a 46,000; 2g 1,240 + 12% × 26,100 = 4,372.00;
    // 2h / 26 = 168.15. SS 130.20; Medicare 30.45. Net 2,100 − 168.15 −
    // 130.20 − 30.45 = 1,771.20.
    const r = calculatePaycheck({
      ...job({ salary: 52_000, period: "biweekly" }),
      earnings: [
        {
          name: "Stipend",
          amount: 100,
          isCash: true,
          federalTaxable: true,
          ficaTaxable: true,
        },
      ],
    });
    cents(
      {
        federal: r.federalWithholding,
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      { federal: 168.15, ss: 130.2, medicare: 30.45, net: 1_771.2 },
      0.01,
    );
  });

  it("paycheck/PAY02-3 [PAY-02] a row the profile gives no amount adds nothing", () => {
    // Two rows, only the first has an amount: one line, its flags kept.
    const lines = earningLines(
      [
        {
          id: 1,
          earningName: "Group-term life",
          isCash: false,
          federalTaxable: true,
          ficaTaxable: true,
        },
        {
          id: 2,
          earningName: "Stipend",
          isCash: true,
          federalTaxable: true,
          ficaTaxable: true,
        },
      ],
      { "1": 20 },
    );
    expect(lines).toEqual([
      {
        name: "Group-term life",
        amount: 20,
        isCash: false,
        federalTaxable: true,
        ficaTaxable: true,
      },
    ]);
  });
});

describe("answer key: deductions by tax treatment", () => {
  it("paycheck/PAY03-1 [PAY-03] § 125 and § 132(f) money pre-tax and FICA-exempt; after-tax neither", () => {
    expect([
      deductionLine(
        { deductionName: "Health", isPretax: true, ficaExempt: true },
        150,
      ),
      deductionLine(
        { deductionName: "Disability", isPretax: false, ficaExempt: false },
        20,
      ),
    ]).toEqual([
      {
        name: "Health",
        amount: 150,
        taxTreatment: "pre_tax",
        ficaExempt: true,
      },
      {
        name: "Disability",
        amount: 20,
        taxTreatment: "after_tax",
        ficaExempt: false,
      },
    ]);
    // Pre-tax for income tax: traditional and HSA money; Roth (402A) and
    // after-tax money are taxed now.
    expect([
      isPreTax("pre_tax"),
      isPreTax("hsa"),
      isPreTax("tax_free"),
      isPreTax("after_tax"),
    ]).toEqual([true, true, false, false]);
  });

  it("paycheck/PAY03-2 [PAY-03] the check: § 125 out of both wages, after-tax out of neither", () => {
    // Single 2026, $52,000 biweekly; § 125 health 150, commuter 50, after-
    // tax disability 20. Income-tax and FICA wages 2,000 − 200 = 1,800.
    // 1c 46,800; 2a 38,200; 2g 1,240 + 12% × 18,300 = 3,436.00; 2h / 26 =
    // 132.15. SS 6.2% × 1,800 = 111.60; Medicare 26.10. Net 2,000 − 220 −
    // 132.15 − 111.60 − 26.10 = 1,510.15.
    const r = calculatePaycheck(
      job({
        salary: 52_000,
        period: "biweekly",
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
        ss: r.ficaSS,
        medicare: r.ficaMedicare,
        net: r.netPay,
      },
      { federal: 132.15, ss: 111.6, medicare: 26.1, net: 1_510.15 },
      0.01,
    );
  });
});

describe("answer key: Medicare per check", () => {
  it("paycheck/PAY11-1 [PAY-11] 1.45% of the check's FICA wages, every check under $200,000", () => {
    // Single 2026, $78,000 biweekly ($3,000), § 125 health 100: FICA
    // wages 2,900; Medicare 1.45% × 2,900 = 42.05 on every check, 1,093.30
    // for the year.
    const r = calculatePaycheck(
      job({
        salary: 78_000,
        period: "biweekly",
        deductions: [deduction("Health", 100, "pre_tax")],
      }),
    );
    cents(
      {
        check: r.ficaMedicare,
        year:
          Math.round(
            r.yearSchedule.reduce((s, p) => s + p.ficaMedicare, 0) * 100,
          ) / 100,
      },
      { check: 42.05, year: 1_093.3 },
    );
  });
});
