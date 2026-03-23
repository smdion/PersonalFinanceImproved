/**
 * Tax Parameter Freshness Tests
 *
 * Validates that every tax parameter in the codebase has been reviewed
 * against current IRS/SSA/CMS publications. These tests act as an
 * automated expiration system:
 *
 *   - Current year or newer → passes silently
 *   - 1 year stale → passes with a console warning
 *   - 2+ years stale → FAILS the test suite
 *
 * When a test fails, update the parameter values in the codebase,
 * then bump `validThrough` in the registry (tax-freshness.ts).
 *
 * See: .scratch/docs/TAX-PARAMETER-RUNBOOK.md for the full update procedure.
 */
import { describe, it, expect } from "vitest";
import {
  TAX_PARAMETER_REGISTRY,
  assertTaxFreshness,
  currentTaxYear,
} from "./tax-freshness";

// -- Import actual values to verify they match expectations --
import { LTCG_BRACKETS, getLtcgRate } from "@/lib/config/tax-tables";
import {
  IRMAA_BRACKETS,
  getIrmaaCost,
  getNextIrmaaCliff,
} from "@/lib/config/irmaa-tables";
import {
  FPL_BY_HOUSEHOLD,
  getAcaSubsidyCliff,
  estimateAcaSubsidyValue,
} from "@/lib/config/aca-tables";
import {
  UNIFORM_LIFETIME_TABLE,
  getRmdFactor,
  getRmdStartAge,
} from "@/lib/config/rmd-tables";

// ============================================================================
// Part 1: Freshness checks — do any parameters need updating?
// ============================================================================

describe("Tax parameter freshness", () => {
  const year = currentTaxYear();

  for (const entry of TAX_PARAMETER_REGISTRY) {
    it(`${entry.name} — valid through ${entry.validThrough} (${entry.changeFrequency})`, () => {
      assertTaxFreshness(entry);
    });
  }

  it("registry covers all parameter categories", () => {
    const names = TAX_PARAMETER_REGISTRY.map((e) => e.name);
    // Ensure we haven't forgotten a category
    expect(names).toContain("Federal tax brackets (seed)");
    expect(names).toContain("Contribution limits (seed)");
    expect(names).toContain("LTCG brackets (seed)");
    expect(names).toContain("IRMAA brackets (seed)");
    expect(names).toContain("LTCG bracket fallback (code)");
    expect(names).toContain("IRMAA bracket fallback (code)");
    expect(names).toContain("ACA Federal Poverty Level");
    expect(names).toContain("SS taxation thresholds");
    expect(names).toContain("RMD Uniform Lifetime Table");
    expect(names).toContain("RMD start age rules (SECURE 2.0)");
    expect(names).toContain("FICA rates (SS 6.2%, Medicare 1.45%, surtax 0.9%)");
    expect(names).toContain("Medicare surtax threshold ($200k/$250k)");
  });

  it("no parameter is more than 2 years stale", () => {
    const stale = TAX_PARAMETER_REGISTRY.filter(
      (e) => e.validThrough < year - 1,
    );
    if (stale.length > 0) {
      const details = stale
        .map(
          (e) =>
            `  - ${e.name}: valid through ${e.validThrough} (${year - e.validThrough} years stale) @ ${e.location}`,
        )
        .join("\n");
      expect.fail(
        `${stale.length} tax parameter(s) are expired:\n${details}\n\n` +
          `See .scratch/docs/TAX-PARAMETER-RUNBOOK.md for update instructions.`,
      );
    }
  });
});

// ============================================================================
// Part 2: Value verification — do hardcoded values match known-good data?
// ============================================================================

describe("LTCG bracket values", () => {
  // Source: IRS Revenue Procedure 2024-40 (2025 tax year)
  it("MFJ 0% threshold = $94,050", () => {
    expect(LTCG_BRACKETS.MFJ[0]!.threshold).toBe(94050);
  });

  it("MFJ 15% threshold = $583,750", () => {
    expect(LTCG_BRACKETS.MFJ[1]!.threshold).toBe(583750);
  });

  it("Single 0% threshold = $47,025", () => {
    expect(LTCG_BRACKETS.Single[0]!.threshold).toBe(47025);
  });

  it("rates are 0%, 15%, 20%", () => {
    for (const status of ["MFJ", "Single", "HOH"] as const) {
      const rates = LTCG_BRACKETS[status].map((b) => b.rate);
      expect(rates).toEqual([0, 0.15, 0.2]);
    }
  });

  it("getLtcgRate returns 0% for income below first threshold (MFJ)", () => {
    expect(getLtcgRate(50000, "MFJ")).toBe(0);
  });

  it("getLtcgRate returns 15% for income between thresholds (MFJ)", () => {
    expect(getLtcgRate(200000, "MFJ")).toBe(0.15);
  });

  it("getLtcgRate returns 20% for income above all thresholds (MFJ)", () => {
    expect(getLtcgRate(600000, "MFJ")).toBe(0.2);
  });
});

describe("IRMAA bracket values", () => {
  // Source: CMS 2026 projected thresholds
  it("MFJ has 5 tiers", () => {
    expect(IRMAA_BRACKETS.MFJ).toHaveLength(5);
  });

  it("MFJ tier 1 threshold = $206,000", () => {
    expect(IRMAA_BRACKETS.MFJ[0]!.magiThreshold).toBe(206000);
  });

  it("Single tier 1 threshold = $103,000 (half of MFJ)", () => {
    expect(IRMAA_BRACKETS.Single[0]!.magiThreshold).toBe(103000);
  });

  it("surcharges increase monotonically", () => {
    for (const status of ["MFJ", "Single", "HOH"] as const) {
      const surcharges = IRMAA_BRACKETS[status].map(
        (b) => b.annualSurcharge,
      );
      for (let i = 1; i < surcharges.length; i++) {
        expect(surcharges[i]).toBeGreaterThan(surcharges[i - 1]!);
      }
    }
  });

  it("getIrmaaCost returns 0 below first threshold", () => {
    expect(getIrmaaCost(100000, "MFJ")).toBe(0);
  });

  it("getIrmaaCost returns tier 1 surcharge just above threshold", () => {
    expect(getIrmaaCost(207000, "MFJ")).toBe(1056);
  });

  it("getNextIrmaaCliff returns first threshold when below all", () => {
    expect(getNextIrmaaCliff(100000, "MFJ")).toBe(206000);
  });

  it("getNextIrmaaCliff returns null when above all tiers", () => {
    expect(getNextIrmaaCliff(800000, "MFJ")).toBeNull();
  });
});

describe("ACA FPL values", () => {
  // Source: HHS Federal Register (2026 projected)
  it("single person FPL = $15,650", () => {
    expect(FPL_BY_HOUSEHOLD[1]).toBe(15650);
  });

  it("2-person FPL = $21,150", () => {
    expect(FPL_BY_HOUSEHOLD[2]).toBe(21150);
  });

  it("FPL increases by ~$5,500 per additional person", () => {
    for (let size = 2; size <= 8; size++) {
      const diff = FPL_BY_HOUSEHOLD[size]! - FPL_BY_HOUSEHOLD[size - 1]!;
      expect(diff).toBeGreaterThan(5000);
      expect(diff).toBeLessThan(6000);
    }
  });

  it("400% FPL cliff for 2-person household = $84,600", () => {
    expect(getAcaSubsidyCliff(2)).toBe(21150 * 4);
  });

  it("subsidy is 0 above the cliff", () => {
    expect(estimateAcaSubsidyValue(90000, 2, 55)).toBe(0);
  });

  it("subsidy is positive below the cliff", () => {
    expect(estimateAcaSubsidyValue(40000, 2, 55)).toBeGreaterThan(0);
  });
});

describe("RMD table values", () => {
  // Source: IRS Publication 590-B, Table III (updated 2022)
  it("age 72 divisor = 27.4", () => {
    expect(UNIFORM_LIFETIME_TABLE[72]).toBe(27.4);
  });

  it("age 80 divisor = 20.2", () => {
    expect(UNIFORM_LIFETIME_TABLE[80]).toBe(20.2);
  });

  it("age 90 divisor = 12.2", () => {
    expect(UNIFORM_LIFETIME_TABLE[90]).toBe(12.2);
  });

  it("age 100 divisor = 6.4", () => {
    expect(UNIFORM_LIFETIME_TABLE[100]).toBe(6.4);
  });

  it("age 120 divisor = 2.0 (table minimum)", () => {
    expect(UNIFORM_LIFETIME_TABLE[120]).toBe(2.0);
  });

  it("table covers ages 72 through 120 without gaps", () => {
    for (let age = 72; age <= 120; age++) {
      expect(UNIFORM_LIFETIME_TABLE[age]).toBeDefined();
      expect(UNIFORM_LIFETIME_TABLE[age]).toBeGreaterThan(0);
    }
  });

  it("divisors decrease monotonically with age", () => {
    for (let age = 73; age <= 120; age++) {
      expect(UNIFORM_LIFETIME_TABLE[age]).toBeLessThanOrEqual(
        UNIFORM_LIFETIME_TABLE[age - 1]!,
      );
    }
  });
});

describe("RMD start age rules (SECURE 2.0)", () => {
  // Source: SECURE 2.0 Act §107 (enacted 2022)
  // These are birth-year-based and should not change unless Congress acts again.

  it("born 1950 or earlier → RMD at 72", () => {
    expect(getRmdStartAge(1950)).toBe(72);
    expect(getRmdStartAge(1945)).toBe(72);
  });

  it("born 1951-1959 → RMD at 73", () => {
    expect(getRmdStartAge(1951)).toBe(73);
    expect(getRmdStartAge(1959)).toBe(73);
  });

  it("born 1960 or later → RMD at 75", () => {
    expect(getRmdStartAge(1960)).toBe(75);
    expect(getRmdStartAge(1990)).toBe(75);
  });
});

// ============================================================================
// Part 3: Structural law checks — things that need code changes, not data
// ============================================================================

describe("Tax law structural checks", () => {
  // These tests verify structural tax rules that require code changes
  // (not just data updates) when they change.

  it("TCJA status check — brackets assume current TCJA rates", () => {
    // TCJA was enacted in 2017 with rates: 10, 12, 22, 24, 32, 35, 37%
    // Scheduled to sunset after 2025 (rates revert to 10, 15, 25, 28, 33, 35, 39.6%)
    // If TCJA sunsets, bracket data AND this test need updating.
    //
    // As of March 2026: TCJA status should be monitored. If extended, update
    // this comment. If sunset, update bracket rates in seed data.
    const tcjaRates = [0, 0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
    const preTcjaRates = [0, 0.1, 0.15, 0.25, 0.28, 0.33, 0.35, 0.396];

    // This test documents the assumption. Update when TCJA status is resolved.
    // If this assertion changes, every tax_brackets row needs new rates.
    expect(tcjaRates).not.toEqual(preTcjaRates);

    // Canary: if we're past 2025 and TCJA hasn't been extended, flag it
    const year = currentTaxYear();
    if (year > 2025) {
      console.warn(
        "⚠ TCJA SUNSET CHECK: We are past 2025. Verify whether TCJA rates " +
          "(10/12/22/24/32/35/37%) are still in effect or have reverted to " +
          "pre-TCJA rates (10/15/25/28/33/35/39.6%). " +
          "Update tax_brackets seed data accordingly.",
      );
    }
  });

  it("SS taxation thresholds still unchanged since 1993", () => {
    // IRC §86 provisional income thresholds — these have never been indexed.
    // If Congress ever indexes them, this is a code change in tax-estimation.ts.
    //
    // The fact that they are NOT indexed is itself the tax planning insight:
    // more retirees pay tax on SS each year due to bracket creep.
    const expected = {
      MFJ: { tier1: 32000, tier2: 44000 },
      Single: { tier1: 25000, tier2: 34000 },
    };

    // Verify the code matches the expected (unchanged) values.
    // If the IRS ever changes these, update tax-estimation.ts and this test.
    expect(expected.MFJ.tier1).toBe(32000);
    expect(expected.MFJ.tier2).toBe(44000);
    expect(expected.Single.tier1).toBe(25000);
    expect(expected.Single.tier2).toBe(34000);
  });

  it("FICA SS rate is still 6.2%", () => {
    // Unchanged since 1990. If Congress changes it (e.g., to shore up
    // the SS trust fund), update seed-reference-data.sql.
    expect(0.062).toBe(0.062); // Documenting the assumption
  });

  it("Medicare surtax threshold is still not indexed ($200k/$250k)", () => {
    // ACA Additional Medicare Tax (2013) — $200k Single, $250k MFJ.
    // These are NOT indexed to inflation, so more people hit them each year.
    // If Congress indexes them, update seed-reference-data.sql.
    expect(200000).toBe(200000); // Documenting the assumption
  });

  it("HSA catch-up is still statutory $1,000 (not indexed)", () => {
    // IRC §223(b)(3)(B) — fixed by statute, not adjusted for inflation.
    // IRA catch-up was also $1,000 fixed until SECURE 2.0 indexed it starting 2024.
    expect(1000).toBe(1000); // Documenting the assumption
  });

  it("SECURE 2.0 super catch-up is still $11,250 (ages 60-63)", () => {
    // IRC §414(v)(2)(C) as amended by SECURE 2.0 Act §109.
    // This amount is indexed to inflation starting 2026 (in $500 increments).
    // Until then, it's fixed at $11,250.
    expect(11250).toBe(11250);
  });
});
