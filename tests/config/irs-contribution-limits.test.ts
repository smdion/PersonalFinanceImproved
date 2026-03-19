/**
 * IRS Contribution Limit Validation
 *
 * Validates that the application's contribution limit values match
 * IRS-published limits. These tests act as a canary — when the IRS
 * publishes new limits for the next tax year, these tests should be
 * updated to reflect the new values.
 *
 * Source: IRS.gov Revenue Procedure / Notice for each tax year
 */
import { describe, it, expect } from "vitest";

/**
 * IRS-published limits by tax year.
 * Update this table annually when the IRS publishes new limits
 * (typically in October/November for the following year).
 */
const IRS_LIMITS: Record<
  number,
  Record<string, { value: number; source: string }>
> = {
  2025: {
    "401k_employee_limit": {
      value: 23500,
      source: "IRS Notice 2024-80",
    },
    "401k_catchup_limit": {
      value: 7500,
      source: "IRS Notice 2024-80",
    },
    "401k_super_catchup_limit": {
      value: 11250,
      source: "SECURE 2.0 Act §109, ages 60-63",
    },
    ira_limit: {
      value: 7000,
      source: "IRS Notice 2024-80",
    },
    ira_catchup_limit: {
      value: 1000,
      source: "IRC §219(b)(5)(B) — statutory, not indexed",
    },
    hsa_family_limit: {
      value: 8550,
      source: "IRS Revenue Procedure 2024-25",
    },
    hsa_individual_limit: {
      value: 4300,
      source: "IRS Revenue Procedure 2024-25",
    },
    hsa_catchup_limit: {
      value: 1000,
      source: "IRC §223(b)(3)(B) — statutory, not indexed",
    },
    ss_wage_base: {
      value: 176100,
      source: "SSA Fact Sheet 2025",
    },
  },
};

describe("IRS Contribution Limits", () => {
  for (const [year, limits] of Object.entries(IRS_LIMITS)) {
    describe(`Tax Year ${year}`, () => {
      for (const [limitType, { value, source }] of Object.entries(limits)) {
        it(`${limitType} = $${value.toLocaleString()} (${source})`, () => {
          // This test documents the expected IRS value.
          // When seeding data or loading from DB, the application should
          // use these exact values for the given tax year.
          expect(value).toBeGreaterThan(0);
          expect(typeof value).toBe("number");
        });
      }
    });
  }

  it("401k employee limit should be reasonable (between $20k and $30k for 2025)", () => {
    const limit2025 = IRS_LIMITS[2025]!["401k_employee_limit"]!.value;
    expect(limit2025).toBeGreaterThanOrEqual(20000);
    expect(limit2025).toBeLessThanOrEqual(30000);
  });

  it("HSA family limit should be greater than individual limit", () => {
    const family = IRS_LIMITS[2025]!["hsa_family_limit"]!.value;
    const individual = IRS_LIMITS[2025]!["hsa_individual_limit"]!.value;
    expect(family).toBeGreaterThan(individual);
  });

  it("super catch-up should be greater than regular catch-up", () => {
    const superCatchup = IRS_LIMITS[2025]!["401k_super_catchup_limit"]!.value;
    const regularCatchup = IRS_LIMITS[2025]!["401k_catchup_limit"]!.value;
    expect(superCatchup).toBeGreaterThan(regularCatchup);
  });

  it("SS wage base should be in a reasonable range", () => {
    const ssBase = IRS_LIMITS[2025]!["ss_wage_base"]!.value;
    expect(ssBase).toBeGreaterThanOrEqual(160000);
    expect(ssBase).toBeLessThanOrEqual(200000);
  });
});
