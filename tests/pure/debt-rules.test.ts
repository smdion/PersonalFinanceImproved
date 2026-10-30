import { describe, it, expect } from "vitest";
import {
  carPaymentShare,
  checkCarLoan,
  firstFullSalary,
} from "@/lib/pure/debt-rules";

describe("checkCarLoan (20 and 3)", () => {
  it("20% down exactly and a 36-month term pass", () => {
    expect(
      checkCarLoan({
        name: "Car",
        purchasePrice: 30_000,
        originalAmount: 24_000,
        termMonths: 36,
      }),
    ).toEqual({
      name: "Car",
      downShare: 0.2,
      termMonths: 36,
      downOk: true,
      termOk: true,
    });
  });

  it("less down or a longer term misses; missing fields aren't judged", () => {
    const c = checkCarLoan({
      name: "Car",
      purchasePrice: 30_000,
      originalAmount: 27_000,
      termMonths: 60,
    });
    expect([c.downOk, c.termOk]).toEqual([false, false]);
    const unknown = checkCarLoan({
      name: "Car",
      purchasePrice: null,
      originalAmount: 27_000,
      termMonths: null,
    });
    expect([unknown.downOk, unknown.termOk]).toEqual([null, null]);
  });
});

describe("carPaymentShare (8)", () => {
  it("every car payment together against gross monthly pay", () => {
    expect(carPaymentShare([400, 400], 120_000)).toBeCloseTo(0.08);
  });
  it("unknown with a missing payment or no pay", () => {
    expect(carPaymentShare([400, null], 120_000)).toBeNull();
    expect(carPaymentShare([400], 0)).toBeNull();
  });
});

describe("firstFullSalary", () => {
  const salaries = [
    { year: 2014, salary: 20_000 },
    { year: 2015, salary: 52_000 },
    { year: 2016, salary: 55_000 },
  ];
  it("the first year at or after the loans, skipping a year a job started after January", () => {
    expect(firstFullSalary(salaries, ["2014-07-01"], 2010)).toEqual({
      year: 2015,
      salary: 52_000,
    });
    expect(firstFullSalary(salaries, ["2014-01-06"], 2010)).toEqual({
      year: 2014,
      salary: 20_000,
    });
  });
  it("nothing within the window — further out it isn't the first-year salary", () => {
    expect(firstFullSalary(salaries, [], 2005)).toBeNull();
  });
});
