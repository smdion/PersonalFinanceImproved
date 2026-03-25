/**
 * Tests for pure historical data temporal resolution logic.
 * Covers: resolveSalaryForYear, buildSalaryByYear, resolveCarryForwardAssetValue,
 * resolveOtherAssetsForYear, computeHomeImpCumulative.
 */
import { describe, it, expect } from "vitest";
import {
  resolveSalaryForYear,
  buildSalaryByYear,
  resolveCarryForwardAssetValue,
  resolveOtherAssetsForYear,
  computeHomeImpCumulative,
} from "@/lib/pure/historical";

describe("resolveSalaryForYear", () => {
  const job = {
    startDate: "2020-01-01",
    endDate: null,
    salary: 80000,
    changes: [
      { effectiveDate: "2021-06-01", newSalary: 90000 },
      { effectiveDate: "2023-01-01", newSalary: 110000 },
    ],
  };

  it("returns starting salary before any changes", () => {
    expect(resolveSalaryForYear(job, 2020)).toBe(80000);
  });

  it("returns salary after first change", () => {
    expect(resolveSalaryForYear(job, 2022)).toBe(90000);
  });

  it("returns salary after latest change", () => {
    expect(resolveSalaryForYear(job, 2024)).toBe(110000);
  });

  it("returns salary on the change year itself", () => {
    expect(resolveSalaryForYear(job, 2023)).toBe(110000);
  });
});

describe("buildSalaryByYear", () => {
  it("builds lookup across multiple people and jobs", () => {
    const people = [
      {
        personName: "Alice",
        timeline: [
          {
            startDate: "2022-01-01",
            endDate: null,
            salary: 100000,
            changes: [{ effectiveDate: "2023-06-01", newSalary: 120000 }],
          },
        ],
      },
      {
        personName: "Bob",
        timeline: [
          {
            startDate: "2023-01-01",
            endDate: "2023-12-31",
            salary: 80000,
            changes: [],
          },
        ],
      },
    ];
    const result = buildSalaryByYear(people);
    expect(result.get(2022)?.get("Alice")).toBe(100000);
    expect(result.get(2023)?.get("Alice")).toBe(120000);
    expect(result.get(2023)?.get("Bob")).toBe(80000);
    expect(result.get(2022)?.has("Bob")).toBe(false);
  });
});

describe("resolveCarryForwardAssetValue", () => {
  const items = [
    { name: "Car", year: 2020, value: "15000", note: "Toyota" },
    { name: "Car", year: 2022, value: "12000", note: "depreciated" },
    { name: "Car", year: 2024, value: "0", note: "sold" },
    { name: "Boat", year: 2021, value: "30000", note: null },
  ];

  it("returns most recent value at-or-before year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2021);
    expect(result).toEqual({ value: 15000, note: "Toyota" });
  });

  it("returns updated value after change year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2023);
    expect(result).toEqual({ value: 12000, note: "depreciated" });
  });

  it("returns null when value drops to 0", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2024);
    expect(result).toBeNull();
  });

  it("returns null when no entries before year", () => {
    const result = resolveCarryForwardAssetValue(items, "Car", 2019);
    expect(result).toBeNull();
  });

  it("carries forward correctly across years", () => {
    const result = resolveCarryForwardAssetValue(items, "Boat", 2025);
    expect(result).toEqual({ value: 30000, note: null });
  });
});

describe("resolveOtherAssetsForYear", () => {
  const assets = [
    { name: "Car", year: 2020, value: "15000", note: null },
    { name: "Boat", year: 2021, value: "30000", note: "new" },
    { name: "Car", year: 2023, value: "0", note: "sold" },
  ];

  it("includes only positive-value assets", () => {
    const result = resolveOtherAssetsForYear(assets, 2022);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(45000);
  });

  it("excludes zero-value assets after disposal", () => {
    const result = resolveOtherAssetsForYear(assets, 2024);
    expect(result.items).toHaveLength(1); // only Boat
    expect(result.total).toBe(30000);
  });
});

describe("computeHomeImpCumulative", () => {
  const items = [
    { year: 2019, cost: "5000" },
    { year: 2020, cost: "15000" },
    { year: 2022, cost: "8000" },
  ];

  it("sums up to target year", () => {
    expect(computeHomeImpCumulative(items, 2020)).toBe(20000);
  });

  it("includes all items when past last year", () => {
    expect(computeHomeImpCumulative(items, 2025)).toBe(28000);
  });

  it("returns 0 for year before first item", () => {
    expect(computeHomeImpCumulative(items, 2018)).toBe(0);
  });

  it("handles null costs", () => {
    expect(
      computeHomeImpCumulative(
        [
          { year: 2020, cost: null },
          { year: 2021, cost: "5000" },
        ],
        2021,
      ),
    ).toBe(5000);
  });
});
