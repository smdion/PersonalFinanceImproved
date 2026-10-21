/**
 * checkPaystub — one stub's figures against Ledgr's for the same check
 * (fictional numbers).
 */
import { describe, it, expect } from "vitest";
import {
  checkPaystub,
  linesSummingTo,
  type PaystubLedgrCheck,
} from "@/lib/pure/paystub-check";
import { PAYSTUB_MAX_LINES as MAX_LINES } from "@/lib/constants";

// $4,000 gross; a $400 traditional 401(k) (pre-tax, FICA wages), $150
// medical (Section 125: pre-tax and FICA-exempt), $25 life insurance
// (after-tax).
const ledgr: PaystubLedgrCheck = {
  gross: 4_000,
  federalTaxableGross: 3_450,
  ficaWages: 3_850,
  federalWithholding: 410,
  netPay: 2_870.47,
  ssStopped: false,
  additionalMedicare: false,
  rates: { socialSecurity: 0.062, medicare: 0.0145 },
  lines: [
    {
      name: "401k (Traditional)",
      amount: 400,
      pretax: true,
      ficaExempt: false,
    },
    { name: "Medical", amount: 150, pretax: true, ficaExempt: true },
    { name: "Life insurance", amount: 25, pretax: false, ficaExempt: false },
  ],
  hasNonCashEarnings: false,
};

const finding = (r: ReturnType<typeof checkPaystub>, key: string) =>
  r.findings.find((f) => f.key === key)!;

describe("checkPaystub", () => {
  it("a stub that matches (within $1) says so", () => {
    const r = checkPaystub(ledgr, {
      gross: 4_000,
      federalTaxableWages: 3_450.4,
      socialSecurityWages: 3_850,
      federalWithholding: 412,
      netPay: 2_870,
    });
    expect(r.allMatch).toBe(true);
    expect(r.findings.every((f) => f.status === "match")).toBe(true);
  });

  it("only the figures entered are compared", () => {
    const r = checkPaystub(ledgr, { gross: 4_000 });
    expect(r.findings.map((f) => f.key)).toEqual(["gross"]);
    expect(checkPaystub(ledgr, {}).allMatch).toBe(false);
  });

  it("federal taxable higher by a pre-tax line: that line looks after-tax", () => {
    const r = checkPaystub(ledgr, { federalTaxableWages: 3_600 });
    const f = finding(r, "federalTaxableWages");
    expect(f.status).toBe("off");
    expect(f.note).toMatch(/^Medical looks after-tax/);
  });

  it("federal taxable lower by an after-tax line: it looks before-tax", () => {
    const f = finding(
      checkPaystub(ledgr, { federalTaxableWages: 3_425 }),
      "federalTaxableWages",
    );
    expect(f.note).toMatch(/^Life insurance looks before-tax/);
  });

  it("federal taxable higher with no line to explain it: a taxable benefit", () => {
    const f = finding(
      checkPaystub(ledgr, { federalTaxableWages: 3_462.5 }),
      "federalTaxableWages",
    );
    expect(f.note).toMatch(/taxable benefit of \$12\.50 a check/);
    // Already entered one: don't suggest another.
    const g = finding(
      checkPaystub(
        { ...ledgr, hasNonCashEarnings: true },
        { federalTaxableWages: 3_462.5 },
      ),
      "federalTaxableWages",
    );
    expect(g.note).toMatch(/Not explained/);
  });

  it("Social Security wages lower by a FICA-taxed line: it looks Section 125", () => {
    const f = finding(
      checkPaystub(ledgr, { socialSecurityWages: 3_825 }),
      "socialSecurityWages",
    );
    expect(f.note).toMatch(/^Life insurance looks exempt from Social Security/);
  });

  it("works the wages back from the tax when the stub has no wage box", () => {
    // 3,850 × 6.2% = 238.70; a cent of rounding is inside the tolerance.
    expect(
      finding(
        checkPaystub(ledgr, { socialSecurity: 238.71 }),
        "socialSecurityWages",
      ).status,
    ).toBe("match");
    // 150 more in FICA wages = $9.30 more Social Security.
    const f = finding(
      checkPaystub(ledgr, { socialSecurity: 248 }),
      "socialSecurityWages",
    );
    expect(f.status).toBe("off");
    expect(f.note).toMatch(/^Medical looks subject to Social Security/);
  });

  it("skips Social Security once the year's pay is past the wage base", () => {
    const f = finding(
      checkPaystub({ ...ledgr, ssStopped: true }, { socialSecurity: 0 }),
      "socialSecurityWages",
    );
    expect(f.status).toBe("skipped");
  });

  it("skips the Medicare back-solve under Additional Medicare, not the wage box", () => {
    const withAdditional = { ...ledgr, additionalMedicare: true };
    expect(
      finding(checkPaystub(withAdditional, { medicare: 90 }), "medicareWages")
        .status,
    ).toBe("skipped");
    expect(
      finding(
        checkPaystub(withAdditional, { medicareWages: 3_850 }),
        "medicareWages",
      ).status,
    ).toBe("match");
  });

  it("withholding: a few dollars' band, and only once taxable wages match", () => {
    expect(
      finding(
        checkPaystub(ledgr, {
          federalTaxableWages: 3_450,
          federalWithholding: 413,
        }),
        "federalWithholding",
      ).status,
    ).toBe("match");
    const w4 = finding(
      checkPaystub(ledgr, {
        federalTaxableWages: 3_450,
        federalWithholding: 450,
      }),
      "federalWithholding",
    );
    expect(w4.status).toBe("off");
    expect(w4.note).toMatch(/W-4/);
    expect(
      finding(
        checkPaystub(ledgr, {
          federalTaxableWages: 3_600,
          federalWithholding: 450,
        }),
        "federalWithholding",
      ).status,
    ).toBe("skipped");
    // Without the taxable wages there's nothing to say the wages match.
    const alone = finding(
      checkPaystub(ledgr, { federalWithholding: 450 }),
      "federalWithholding",
    );
    expect(alone.status).toBe("skipped");
    expect(alone.note).toMatch(/federal taxable wages too/);
  });

  it("net pay off under Additional Medicare: says that's why", () => {
    const f = finding(
      checkPaystub(
        { ...ledgr, additionalMedicare: true },
        { gross: 4_000, netPay: 2_835 },
      ),
      "netPay",
    );
    expect(f.note).toMatch(/Additional Medicare/);
  });

  it("net pay off with everything else matching: something isn't in Ledgr", () => {
    const f = finding(
      checkPaystub(ledgr, { gross: 4_000, netPay: 2_850 }),
      "netPay",
    );
    expect(f.note).toMatch(/isn't in Ledgr/);
  });

  it("more than one combination of lines fits: says so", () => {
    const f = finding(
      checkPaystub(
        {
          ...ledgr,
          lines: [
            { name: "Dental", amount: 20, pretax: true, ficaExempt: true },
            { name: "Vision", amount: 20, pretax: true, ficaExempt: true },
          ],
        },
        { federalTaxableWages: 3_470 },
      ),
      "federalTaxableWages",
    );
    expect(f.note).toMatch(/^One of these looks after-tax.*Dental; or Vision/);
  });
});

describe("linesSummingTo", () => {
  it("finds every combination, and looks at most MAX_LINES lines", () => {
    const lines = [10, 20, 30].map((amount, i) => ({ name: `L${i}`, amount }));
    expect(linesSummingTo(lines, 30).map((c) => c.map((l) => l.name))).toEqual([
      ["L0", "L1"],
      ["L2"],
    ]);
    const many = Array.from({ length: MAX_LINES + 2 }, (_, i) => ({
      name: `M${i}`,
      amount: i === MAX_LINES + 1 ? 999 : 1,
    }));
    expect(linesSummingTo(many, 999)).toEqual([]);
  });
});
