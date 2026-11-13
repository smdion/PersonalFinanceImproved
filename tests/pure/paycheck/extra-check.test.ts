/**
 * A 27th payday (PAY-22): the check past an account's covered checks takes only
 * the limit room left. Worked by hand (Pub 15-T 2026 Worksheet 1A, Single, T26).
 *
 * $135,200 biweekly from Thursday January 1, 2026 (27 paydays, the last
 * December 31): 5,200 a check. A traditional 401(k) of 1,000 a check.
 * Check 1 to 26: 1c 4,200 × 26 = 109,200; 2a 109,200 − 8,600 = 100,600;
 * row A 57,900, C 5,800, D 22%: 2g 5,800 + 22% × 42,700 = 15,194; 2h /26 =
 * 584.38. FICA: 6.2% × 5,200 = 322.40, Medicare 75.40. Net 5,200 − 1,000 −
 * 584.38 − 322.40 − 75.40 = 3,217.82.
 * Check 27 with no room (the limit already reached): no 401(k); 1c 5,200 × 26
 * = 135,200; 2a 126,600; row A 113,200, C 17,966, D 24%: 2g 17,966 + 24% ×
 * 13,400 = 21,182; 2h 814.69. FICA the same (deferrals are FICA wages). Net
 * 5,200 − 814.69 − 322.40 − 75.40 = 3,987.51.
 */
import { describe, it } from "vitest";
import { cents } from "../../fixtures/answer-key";
import { account, job } from "../fixtures/paycheck-answer-key";
import { calculatePaycheck } from "@/lib/pure/paycheck/per-check";

const k401 = (room: number) => ({
  ...account({
    name: "401k",
    perCheck: 1000,
    checks: 26,
    treatment: "pre_tax",
  }),
  coveredChecks: 26,
  extraCheckLimit: { group: "401k", room },
});

const run = (room: number) =>
  calculatePaycheck({
    ...job({
      salary: 135_200,
      period: "biweekly",
      accounts: [k401(room)],
    }),
    anchorPayDate: new Date("2026-01-01"),
  });

describe("paycheck/N5-extra [PAY-22] the 27th check takes the limit room left", () => {
  it("no room: no deferral on check 27, its own withholding", () => {
    const rows = run(0).yearSchedule;
    cents(rows.length, 27);
    cents(
      {
        pre26: rows[25]!.preTaxDeductions,
        fed26: rows[25]!.federalWithholding,
        net26: rows[25]!.netPay,
        pre27: rows[26]!.preTaxDeductions,
        fed27: rows[26]!.federalWithholding,
        net27: rows[26]!.netPay,
      },
      {
        pre26: 1000,
        fed26: 584.38,
        net26: 3217.82,
        pre27: 0,
        fed27: 814.69,
        net27: 3987.51,
      },
    );
  });

  it("room for part of it: that part, and nothing past the room", () => {
    cents(run(400).yearSchedule[26]!.preTaxDeductions, 400);
    cents(run(5000).yearSchedule[26]!.preTaxDeductions, 1000);
  });

  it("no limit group (no room given): the 27th check takes the usual amount", () => {
    const noLimit = { ...k401(0), extraCheckLimit: undefined };
    const rows = calculatePaycheck({
      ...job({ salary: 135_200, period: "biweekly", accounts: [noLimit] }),
      anchorPayDate: new Date("2026-01-01"),
    }).yearSchedule;
    cents(rows[26]!.preTaxDeductions, 1000);
  });
});

describe("paycheck/N5-extra: the cap pass's year is the paydays up to 26", () => {
  // The same job started Sunday March 1: five paydays before it (Jan 1, 15,
  // 29, Feb 12, 26), its 22 checks paydays 6 to 27. The cap pass counts its
  // 21 checks up to payday 26 (21 × 1,000 = 21,000); payday 27, past the
  // year's 26 periods, takes the room left: none.
  it("a job started after the year's first payday: payday 27 takes the room left", () => {
    const rows = calculatePaycheck({
      ...job({ salary: 135_200, period: "biweekly", accounts: [k401(0)] }),
      anchorPayDate: new Date("2026-01-01"),
      startDate: new Date("2026-03-01"),
    }).yearSchedule;
    cents(
      {
        payday27: rows[26]!.preTaxDeductions,
        year: rows.reduce((a, r) => a + r.preTaxDeductions, 0),
      },
      { payday27: 0, year: 21_000 },
    );
  });
});

describe("paycheck/N5-extra: FICA-exempt money past the cap", () => {
  // An HSA of 200 a check, its FICA-exempt cap 5,200 = 26 × 200, with 1,000
  // of limit room: payday 27 takes its 200, but the cap is used up, so the
  // 200 is FICA wages on that check (FICA base 5,200 + 200 back).
  it("the 27th check's HSA money is FICA wages once the exempt cap is used", () => {
    const hsa = {
      ...account({
        name: "HSA",
        perCheck: 200,
        checks: 26,
        treatment: "hsa",
        ficaExemptAnnualCap: 5_200,
      }),
      coveredChecks: 26,
      extraCheckLimit: { group: "hsa", room: 1_000 },
    };
    const rows = calculatePaycheck({
      ...job({ salary: 135_200, period: "biweekly", accounts: [hsa] }),
      anchorPayDate: new Date("2026-01-01"),
    }).yearSchedule;
    cents(
      {
        pre27: rows[26]!.preTaxDeductions,
        ss26: rows[25]!.ficaSS,
        ss27: rows[26]!.ficaSS,
      },
      // SS: 6.2% × 5,000 = 310.00 on a usual check; 6.2% × 5,200 = 322.40 on 27.
      { pre27: 200, ss26: 310, ss27: 322.4 },
    );
  });
});
