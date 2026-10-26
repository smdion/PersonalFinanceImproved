/**
 * The figures Settings lists as "Fixed by law", pinned to the law. They're
 * not indexed, so a change here is a change in the law (or a mistake) —
 * update the value, its citation and this test together.
 */
import { describe, it, expect } from "vitest";
import { fixedByLawGroups } from "@/lib/config/fixed-by-law";
import {
  EARLY_WITHDRAWAL_PENALTY_RATE,
  HSA_NON_MEDICAL_PENALTY_AGE,
  HSA_NON_MEDICAL_PENALTY_RATE,
  PENALTY_FREE_AGE,
  QCD_MIN_ELIGIBILITY_AGE,
  RMD_EXCISE_TAX_RATE,
  ROTH_CONVERSION_SEASONING_YEARS,
  RULE_OF_55_AGE,
  ADDITIONAL_STANDARD_DEDUCTION_AGE,
  MEDICARE_START_AGE,
} from "@/lib/constants";
import { NIIT_RATE, NIIT_THRESHOLDS } from "@/lib/config/niit";
import {
  SS_TAX_THRESHOLDS,
  SS_TAX_TIER1_INCLUSION_RATE,
  SS_TAX_TIER2_INCLUSION_RATE,
} from "@/lib/config/ss-tax";
import { getRmdStartAge } from "@/lib/config/rmd-tables";
import {
  ROTH_IRA_MFS_PHASEOUT,
  ROTH_IRA_REDUCED_LIMIT_FLOOR,
  ROTH_IRA_REDUCED_LIMIT_ROUNDING,
} from "@/lib/config/tax-params";

describe("fixed by law", () => {
  it("pins every statutory figure", () => {
    expect(NIIT_RATE).toBe(0.038);
    expect(NIIT_THRESHOLDS).toEqual({
      MFJ: 250000,
      Single: 200000,
      HOH: 200000,
    });
    expect(SS_TAX_THRESHOLDS).toEqual({
      MFJ: { tier1: 32000, tier2: 44000 },
      Single: { tier1: 25000, tier2: 34000 },
      HOH: { tier1: 25000, tier2: 34000 },
    });
    expect([SS_TAX_TIER1_INCLUSION_RATE, SS_TAX_TIER2_INCLUSION_RATE]).toEqual([
      0.5, 0.85,
    ]);
    expect(PENALTY_FREE_AGE).toBe(59.5);
    expect(RULE_OF_55_AGE).toBe(55);
    expect(ADDITIONAL_STANDARD_DEDUCTION_AGE).toBe(65);
    expect(MEDICARE_START_AGE).toBe(65);
    expect(HSA_NON_MEDICAL_PENALTY_AGE).toBe(65);
    expect(QCD_MIN_ELIGIBILITY_AGE).toBe(70);
    expect([1950, 1951, 1959, 1960].map(getRmdStartAge)).toEqual([
      72, 73, 73, 75,
    ]);
    expect(EARLY_WITHDRAWAL_PENALTY_RATE).toBe(0.1);
    expect(HSA_NON_MEDICAL_PENALTY_RATE).toBe(0.2);
    expect(RMD_EXCISE_TAX_RATE).toBe(0.25);
    expect(ROTH_CONVERSION_SEASONING_YEARS).toBe(5);
    expect([
      ROTH_IRA_REDUCED_LIMIT_ROUNDING,
      ROTH_IRA_REDUCED_LIMIT_FLOOR,
    ]).toEqual([10, 200]);
    expect(ROTH_IRA_MFS_PHASEOUT).toEqual({ start: 0, end: 10_000 });
  });

  it("every item has a value and a citation", () => {
    const items = fixedByLawGroups().flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(15);
    for (const i of items) {
      expect(i.value.trim(), i.label).not.toBe("");
      expect(i.value, i.label).not.toMatch(/undefined|NaN/);
      expect(i.citation, i.label).toMatch(/IRC|Act|Pub\./);
    }
  });

  it("reads the catch-up ages from the account config", () => {
    const ages = fixedByLawGroups()
      .flatMap((g) => g.items)
      .find((i) => i.label === "Catch-up contributions from")!;
    expect(ages.value).toBe("401k 50 · IRA 50 · HSA 55");
  });
});
