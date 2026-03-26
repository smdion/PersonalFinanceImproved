/**
 * IRS Contribution Limit Validation
 *
 * Validates that the application's seed data matches IRS-published limits.
 * These tests act as a canary — when the IRS publishes new limits for the
 * next tax year, both the seed SQL AND this test should be updated together.
 *
 * Source: IRS.gov Revenue Procedure / Notice for each tax year
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Parse actual seed data — single source of truth
// ---------------------------------------------------------------------------

const SEED_SQL = fs.readFileSync(
  path.join(process.cwd(), "seed-reference-data.sql"),
  "utf-8",
);

/** Extract contribution_limits rows from seed SQL */
function parseSeedLimits(): Map<string, number> {
  const limits = new Map<string, number>();
  // Match: (year, 'limit_type', value, 'notes')
  const re = /\(\s*(\d+),\s*'([^']+)',\s*([\d.]+),\s*'[^']*'\s*\)/g;
  let match;
  // Only capture lines after "INSERT INTO contribution_limits"
  const section = SEED_SQL.slice(
    SEED_SQL.indexOf("INSERT INTO contribution_limits"),
  );
  const endIdx = section.indexOf("ON CONFLICT");
  const block = endIdx > 0 ? section.slice(0, endIdx) : section;

  while ((match = re.exec(block)) !== null) {
    const year = match[1];
    const type = match[2];
    const value = parseFloat(match[3]);
    limits.set(`${year}:${type}`, value);
  }
  return limits;
}

const seedLimits = parseSeedLimits();

// ---------------------------------------------------------------------------
// IRS-published reference values (update annually)
// ---------------------------------------------------------------------------

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
  2026: {
    "401k_employee_limit": {
      value: 24500,
      source: "IRS Notice 2025-67",
    },
    "401k_catchup_limit": {
      value: 8000,
      source: "IRS Notice 2025-67",
    },
    "401k_super_catchup_limit": {
      value: 11250,
      source: "SECURE 2.0 Act §109, ages 60-63",
    },
    ira_limit: {
      value: 7500,
      source: "IRS Notice 2025-67",
    },
    ira_catchup_limit: {
      value: 1100,
      source: "IRS Notice 2025-67",
    },
    hsa_family_limit: {
      value: 8750,
      source: "IRS Revenue Procedure 2025-XX",
    },
    hsa_individual_limit: {
      value: 4400,
      source: "IRS Revenue Procedure 2025-XX",
    },
    hsa_catchup_limit: {
      value: 1000,
      source: "IRC §223(b)(3)(B) — statutory, not indexed",
    },
    ss_wage_base: {
      value: 184500,
      source: "SSA 2026 wage base",
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IRS Contribution Limits", () => {
  it("seed SQL contains contribution_limits data", () => {
    expect(seedLimits.size).toBeGreaterThan(0);
  });

  for (const [year, limits] of Object.entries(IRS_LIMITS)) {
    describe(`Tax Year ${year}`, () => {
      for (const [limitType, { value, source }] of Object.entries(limits)) {
        it(`${limitType} = $${value.toLocaleString()} (${source})`, () => {
          const seedValue = seedLimits.get(`${year}:${limitType}`);
          expect(
            seedValue,
            `Seed data missing ${year}:${limitType} — update seed-reference-data.sql`,
          ).toBeDefined();
          expect(
            seedValue,
            `Seed value ${seedValue} ≠ IRS value ${value} for ${year}:${limitType}. ` +
              `Either update seed-reference-data.sql or update this test if IRS values changed.`,
          ).toBe(value);
        });
      }
    });
  }

  it("401k employee limit should be reasonable (between $20k and $30k)", () => {
    const limit2026 = IRS_LIMITS[2026]!["401k_employee_limit"]!.value;
    expect(limit2026).toBeGreaterThanOrEqual(20000);
    expect(limit2026).toBeLessThanOrEqual(30000);
  });

  it("HSA family limit should be greater than individual limit", () => {
    const family = IRS_LIMITS[2026]!["hsa_family_limit"]!.value;
    const individual = IRS_LIMITS[2026]!["hsa_individual_limit"]!.value;
    expect(family).toBeGreaterThan(individual);
  });

  it("super catch-up should be greater than regular catch-up", () => {
    const superCatchup = IRS_LIMITS[2026]!["401k_super_catchup_limit"]!.value;
    const regularCatchup = IRS_LIMITS[2026]!["401k_catchup_limit"]!.value;
    expect(superCatchup).toBeGreaterThan(regularCatchup);
  });

  it("SS wage base should be in a reasonable range", () => {
    const ssBase = IRS_LIMITS[2026]!["ss_wage_base"]!.value;
    expect(ssBase).toBeGreaterThanOrEqual(160000);
    expect(ssBase).toBeLessThanOrEqual(200000);
  });
});
