/**
 * IRS Contribution Limit Validation
 *
 * Validates that the application's seed data matches IRS-published limits.
 * These tests act as a canary — when the IRS publishes new limits for the
 * next tax year, both the seed SQL AND this test should be updated together.
 *
 * Source: IRS.gov Revenue Procedure / Notice for each tax year
 */
import { taxDataLimitMap } from "../helpers/tax-data";
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Parse actual seed data — single source of truth
// ---------------------------------------------------------------------------

/** contribution_limits from the tax-data file, `"year:limit_type" → value`. */
function parseSeedLimits(): Map<string, number> {
  return taxDataLimitMap();
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
    additional_std_deduction_65_married: {
      value: 1600,
      source: "IRC §63(f) / IRS Rev. Proc. 2024-40 — per spouse 65+, MFJ",
    },
    additional_std_deduction_65_unmarried: {
      value: 2000,
      source: "IRC §63(f) / IRS Rev. Proc. 2024-40 — filer 65+, Single/HoH",
    },
    standard_deduction_mfj: {
      value: 31500,
      source: "OBBBA §70102 (supersedes Rev. Proc. 2024-40)",
    },
    standard_deduction_single: {
      value: 15750,
      source: "OBBBA §70102 (supersedes Rev. Proc. 2024-40)",
    },
    standard_deduction_hoh: {
      value: 23625,
      source: "OBBBA §70102 (supersedes Rev. Proc. 2024-40)",
    },
    fica_medicare_surtax_liability_mfj: {
      value: 250000,
      source: "IRC §3101(b)(2) — MFJ liability threshold, not indexed",
    },
    fica_medicare_surtax_liability_single: {
      value: 200000,
      source: "IRC §3101(b)(2) — Single liability threshold, not indexed",
    },
    fica_medicare_surtax_liability_hoh: {
      value: 200000,
      source: "IRC §3101(b)(2) — HoH liability threshold, not indexed",
    },
    roth_ira_phaseout_start_mfj: {
      value: 236000,
      source: "IRS Notice 2024-80",
    },
    roth_ira_phaseout_end_mfj: { value: 246000, source: "IRS Notice 2024-80" },
    roth_ira_phaseout_start_single: {
      value: 150000,
      source: "IRS Notice 2024-80",
    },
    roth_ira_phaseout_end_single: {
      value: 165000,
      source: "IRS Notice 2024-80",
    },
    roth_ira_phaseout_start_hoh: {
      value: 150000,
      source: "IRS Notice 2024-80",
    },
    roth_ira_phaseout_end_hoh: { value: 165000, source: "IRS Notice 2024-80" },
    hdhp_min_deductible_self: { value: 1650, source: "IRS Rev. Proc. 2024-25" },
    hdhp_min_deductible_family: {
      value: 3300,
      source: "IRS Rev. Proc. 2024-25",
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
      source: "IRS Revenue Procedure 2025-19",
    },
    hsa_individual_limit: {
      value: 4400,
      source: "IRS Revenue Procedure 2025-19",
    },
    hsa_catchup_limit: {
      value: 1000,
      source: "IRC §223(b)(3)(B) — statutory, not indexed",
    },
    ss_wage_base: {
      value: 184500,
      source: "SSA 2026 wage base",
    },
    additional_std_deduction_65_married: {
      value: 1650,
      source: "IRC §63(f) / IRS Rev. Proc. 2025-32 — per spouse 65+, MFJ",
    },
    additional_std_deduction_65_unmarried: {
      value: 2050,
      source: "IRC §63(f) / IRS Rev. Proc. 2025-32 — filer 65+, Single/HoH",
    },
    standard_deduction_mfj: {
      value: 32200,
      source: "IRS Rev. Proc. 2025-32 (as amended by OBBBA)",
    },
    standard_deduction_single: {
      value: 16100,
      source: "IRS Rev. Proc. 2025-32 (as amended by OBBBA)",
    },
    standard_deduction_hoh: {
      value: 24150,
      source: "IRS Rev. Proc. 2025-32 (as amended by OBBBA)",
    },
    fica_ss_rate: {
      value: 0.062,
      source: "IRC §3101(a) — employee share, unchanged since 1990",
    },
    fica_medicare_surtax_threshold: {
      value: 200000,
      source: "IRC §3101(b)(2) — statutory, not indexed (Single/HoH)",
    },
    fica_medicare_surtax_liability_mfj: {
      value: 250000,
      source: "IRC §3101(b)(2) — MFJ liability threshold, not indexed",
    },
    fica_medicare_surtax_liability_single: {
      value: 200000,
      source: "IRC §3101(b)(2) — Single liability threshold, not indexed",
    },
    fica_medicare_surtax_liability_hoh: {
      value: 200000,
      source: "IRC §3101(b)(2) — HoH liability threshold, not indexed",
    },
    roth_ira_phaseout_start_mfj: {
      value: 242000,
      source: "IRS Notice 2025-67",
    },
    roth_ira_phaseout_end_mfj: { value: 252000, source: "IRS Notice 2025-67" },
    roth_ira_phaseout_start_single: {
      value: 153000,
      source: "IRS Notice 2025-67",
    },
    roth_ira_phaseout_end_single: {
      value: 168000,
      source: "IRS Notice 2025-67",
    },
    roth_ira_phaseout_start_hoh: {
      value: 153000,
      source: "IRS Notice 2025-67",
    },
    roth_ira_phaseout_end_hoh: { value: 168000, source: "IRS Notice 2025-67" },
    hdhp_min_deductible_self: { value: 1700, source: "IRS Rev. Proc. 2025-19" },
    hdhp_min_deductible_family: {
      value: 3400,
      source: "IRS Rev. Proc. 2025-19",
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("seed key completeness", () => {
  // Reads of newer keys are soft (a missing key hides a feature rather than
  // throwing), so a year seeded without one would fail silently once it
  // became the newest year. Every year must carry the previous year's keys.
  it("every tax year has every limit type the previous year had", () => {
    const byYear = new Map<number, Set<string>>();
    for (const key of seedLimits.keys()) {
      const [year, type] = key.split(":");
      const set = byYear.get(Number(year)) ?? new Set<string>();
      set.add(type!);
      byYear.set(Number(year), set);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      const missing = [...byYear.get(years[i - 1]!)!].filter(
        (t) => !byYear.get(years[i]!)!.has(t),
      );
      expect(missing, `${years[i]} is missing`).toEqual([]);
    }
  });
});

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
            `Seed data missing ${year}:${limitType} — update tax-data/us-federal/`,
          ).toBeDefined();
          expect(
            seedValue,
            `Seed value ${seedValue} ≠ IRS value ${value} for ${year}:${limitType}. ` +
              `Either update tax-data/us-federal/ or update this test if IRS values changed.`,
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
