import { describe, it, expect } from "vitest";
import {
  ACCOUNT_TYPE_CONFIG,
  getAllCategories,
  getEngineCategories,
  categoriesWithTaxPreference,
  categoriesWithIrsLimit,
  getAccountTypeConfig,
  getRothFraction,
  getEffectiveLimit,
  isOverflowTarget,
  getLimitGroup,
  getParentCategory,
  getDisplayGroup,
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getBasis,
  getAccountSegments,
  getCategoryColumnKey,
  parseColumnKey,
  getColumnLabel,
  getDefaultAccumulationOrder,
  getDefaultDecumulationOrder,
  defaultDecumulationConfig,
  buildCategoryRecord,
  accountCategoryEnum,
  DEFAULT_WITHDRAWAL_SPLITS,
  getDisplayConfig,
  isDiscountBasisEmployerContrib,
  tracksRothBasis,
  type AccountCategory,
  type AccountBalance,
} from "@/lib/config/account-types";
import {
  CONTRIBUTION_METHOD_LABELS,
  CONTRIBUTION_METHOD_LABELS_SHORT,
  TAX_TREATMENT_LABELS,
  EMPLOYER_MATCH_LABELS,
  displayLabel,
} from "@/lib/config/display-labels";

// ---------------------------------------------------------------------------
// Config completeness
// ---------------------------------------------------------------------------

describe("ACCOUNT_TYPE_CONFIG", () => {
  it("has exactly the expected account categories", () => {
    const keys = Object.keys(ACCOUNT_TYPE_CONFIG).sort();
    expect(keys).toEqual(["401k", "403b", "brokerage", "hsa", "ira"]);
  });

  it("every entry has all required properties", () => {
    const requiredKeys = [
      "displayLabel",
      "description",
      "keywords",
      "supportsRothSplit",
      "balanceStructure",
      "withdrawalTaxType",
      "taxBucketKey",
      "supportedTaxTreatments",
      "hasIrsLimit",
      "irsLimitGroup",
      "irsLimitKeys",
      "matchCountsTowardLimit",
      "isOverflowTarget",
      "fixedContribScalesWithSalary",
      "generateOverflowWarnings",
      "defaultWithdrawalSplit",
      "parentCategory",
      "displayGroup",
      "participatesInEngine",
      "engineParent",
      "colors",
      "employerMatchLabel",
      "hasDiscountBar",
      "employerContribKind",
      "taxPreferenceNote",
      "subTypeOptions",
      "supportsPriorYearContrib",
    ];
    for (const cat of getAllCategories()) {
      const cfg = ACCOUNT_TYPE_CONFIG[cat];
      for (const key of requiredKeys) {
        expect(cfg).toHaveProperty(key);
      }
    }
  });

  it("only ESPP subtype has discount-kind employer contributions", () => {
    for (const cat of getAllCategories()) {
      expect(ACCOUNT_TYPE_CONFIG[cat].employerContribKind).toBe("match");
    }
    expect(getDisplayConfig("brokerage", "ESPP").employerContribKind).toBe(
      "discount",
    );
    expect(isDiscountBasisEmployerContrib("brokerage", "ESPP")).toBe(true);
    expect(isDiscountBasisEmployerContrib("brokerage", null)).toBe(false);
    expect(isDiscountBasisEmployerContrib("401k", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prior-year contribution eligibility
// ---------------------------------------------------------------------------

describe("supportsPriorYearContrib", () => {
  it("is true for IRA and HSA only", () => {
    expect(getAccountTypeConfig("ira").supportsPriorYearContrib).toBe(true);
    expect(getAccountTypeConfig("hsa").supportsPriorYearContrib).toBe(true);
  });

  it("is false for employer-sponsored plans and brokerage", () => {
    expect(getAccountTypeConfig("401k").supportsPriorYearContrib).toBe(false);
    expect(getAccountTypeConfig("403b").supportsPriorYearContrib).toBe(false);
    expect(getAccountTypeConfig("brokerage").supportsPriorYearContrib).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Category list helpers
// ---------------------------------------------------------------------------

describe("getAllCategories", () => {
  it("returns all 5 categories", () => {
    expect(getAllCategories()).toHaveLength(5);
    expect(getAllCategories()).toContain("401k");
    expect(getAllCategories()).toContain("brokerage");
  });
});

describe("getEngineCategories", () => {
  it("returns only categories with participatesInEngine=true", () => {
    const cats = getEngineCategories();
    for (const c of cats) {
      expect(getAccountTypeConfig(c).participatesInEngine).toBe(true);
    }
  });
});

describe("categoriesWithTaxPreference", () => {
  it("returns categories that support Roth split", () => {
    const cats = categoriesWithTaxPreference();
    expect(cats).toContain("401k");
    expect(cats).toContain("ira");
    expect(cats).not.toContain("hsa");
    expect(cats).not.toContain("brokerage");
    for (const c of cats) {
      expect(getAccountTypeConfig(c).supportsRothSplit).toBe(true);
    }
  });
});

describe("categoriesWithIrsLimit", () => {
  it("returns categories with IRS limits", () => {
    const cats = categoriesWithIrsLimit();
    expect(cats).toContain("401k");
    expect(cats).toContain("hsa");
    expect(cats).toContain("ira");
    expect(cats).not.toContain("brokerage");
  });
});

// ---------------------------------------------------------------------------
// Config property helpers
// ---------------------------------------------------------------------------

describe("getRothFraction", () => {
  const splits = { "401k": 0.7, ira: 1.0 } as Partial<
    Record<AccountCategory, number>
  >;

  it("returns the split for 401k", () => {
    expect(getRothFraction("401k", splits)).toBe(0.7);
  });

  it("403b shares 401k split (via irsLimitGroup)", () => {
    expect(getRothFraction("403b", splits)).toBe(0.7);
  });

  it("returns the split for ira", () => {
    expect(getRothFraction("ira", splits)).toBe(1.0);
  });

  it("returns 0 for hsa (no Roth split)", () => {
    expect(getRothFraction("hsa", splits)).toBe(0);
  });

  it("returns 0 for brokerage (no Roth split)", () => {
    expect(getRothFraction("brokerage", splits)).toBe(0);
  });

  it("returns 0 for missing split key", () => {
    expect(getRothFraction("401k", {})).toBe(0);
  });
});

describe("getEffectiveLimit", () => {
  it("returns min of IRS limit and account cap for 401k", () => {
    expect(getEffectiveLimit("401k", 23000, 10000)).toBe(10000);
    expect(getEffectiveLimit("401k", 23000, null)).toBe(23000);
  });

  it("returns Infinity for brokerage (no IRS limit)", () => {
    expect(getEffectiveLimit("brokerage", 0, null)).toBe(Infinity);
  });
});

describe("isOverflowTarget", () => {
  it("brokerage is the overflow target", () => {
    expect(isOverflowTarget("brokerage")).toBe(true);
  });

  it("other categories are not", () => {
    expect(isOverflowTarget("401k")).toBe(false);
    expect(isOverflowTarget("hsa")).toBe(false);
  });
});

describe("getLimitGroup", () => {
  it("401k and 403b share a limit group", () => {
    expect(getLimitGroup("401k")).toBe(getLimitGroup("403b"));
  });

  it("ira has its own group", () => {
    expect(getLimitGroup("ira")).toBe("ira");
  });

  it("brokerage has no limit group", () => {
    expect(getLimitGroup("brokerage")).toBeNull();
  });
});

describe("getParentCategory", () => {
  it("retirement accounts map to Retirement", () => {
    expect(getParentCategory("401k")).toBe("Retirement");
    expect(getParentCategory("ira")).toBe("Retirement");
    expect(getParentCategory("hsa")).toBe("Retirement");
  });

  it("brokerage maps to Portfolio", () => {
    expect(getParentCategory("brokerage")).toBe("Portfolio");
  });
});

describe("getDisplayGroup", () => {
  it("returns correct groups", () => {
    expect(getDisplayGroup("401k")).toBe("retirement");
    expect(getDisplayGroup("hsa")).toBe("hsa");
    expect(getDisplayGroup("brokerage")).toBe("taxable");
  });
});

// ---------------------------------------------------------------------------
// Balance accessors
// ---------------------------------------------------------------------------

describe("balance accessors", () => {
  const rothTrad: AccountBalance = {
    structure: "roth_traditional",
    traditional: 100,
    roth: 50,
  };
  const single: AccountBalance = { structure: "single_bucket", balance: 200 };
  const basis: AccountBalance = {
    structure: "basis_tracking",
    balance: 300,
    basis: 120,
  };

  it("getTraditionalBalance", () => {
    expect(getTraditionalBalance(rothTrad)).toBe(100);
    expect(getTraditionalBalance(single)).toBe(0); // no traditional concept for single bucket
    expect(getTraditionalBalance(basis)).toBe(0); // no traditional concept for basis tracking
  });

  it("getRothBalance", () => {
    expect(getRothBalance(rothTrad)).toBe(50);
    expect(getRothBalance(single)).toBe(0);
    expect(getRothBalance(basis)).toBe(0);
  });

  it("getTotalBalance", () => {
    expect(getTotalBalance(rothTrad)).toBe(150);
    expect(getTotalBalance(single)).toBe(200);
    expect(getTotalBalance(basis)).toBe(300);
  });

  it("getBasis", () => {
    expect(getBasis(rothTrad)).toBe(0);
    expect(getBasis(single)).toBe(0);
    expect(getBasis(basis)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Column / segment helpers
// ---------------------------------------------------------------------------

describe("getAccountSegments", () => {
  it("generates segments for all categories", () => {
    const segments = getAccountSegments();
    expect(segments.length).toBeGreaterThan(0);
    // Every segment should have required fields
    for (const seg of segments) {
      expect(seg).toHaveProperty("key");
      expect(seg).toHaveProperty("label");
      expect(seg).toHaveProperty("category");
    }
  });

  it("categories with Roth split produce _trad and _roth segments", () => {
    const segments = getAccountSegments();
    const k401Segments = segments.filter((s) => s.category === "401k");
    expect(k401Segments.some((s) => s.key.includes("trad"))).toBe(true);
    expect(k401Segments.some((s) => s.key.includes("roth"))).toBe(true);
  });
});

describe("getCategoryColumnKey / parseColumnKey / getColumnLabel", () => {
  it("round-trips a column key", () => {
    const key = getCategoryColumnKey("401k", "trad");
    const parsed = parseColumnKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.category).toBe("401k");
    expect(parsed!.subKey).toBe("trad");
  });

  it("getColumnLabel returns a non-empty string", () => {
    const key = getCategoryColumnKey("hsa");
    expect(getColumnLabel(key).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("defaults", () => {
  it("accumulation order contains all engine categories", () => {
    const order = getDefaultAccumulationOrder();
    for (const c of getEngineCategories()) {
      expect(order).toContain(c);
    }
  });

  it("decumulation order contains all engine categories", () => {
    const order = getDefaultDecumulationOrder();
    for (const c of getEngineCategories()) {
      expect(order).toContain(c);
    }
  });

  it("DEFAULT_WITHDRAWAL_SPLITS values sum to ~1", () => {
    const total = Object.values(DEFAULT_WITHDRAWAL_SPLITS).reduce(
      (a, b) => a + b,
      0,
    );
    expect(total).toBeCloseTo(1.0, 2);
  });

  /**
   * Regression test for a real risk: the Retirement page's own default
   * decumulation form state (use-projection-form-state.ts) and the
   * dashboard Retirement tile's cache-key-matching "peek" queries
   * (retirement-card.tsx) used to hand-build this same shape independently
   * — the projection cache hashes the full engine input, so any drift
   * between the two would silently turn into a permanent cache miss for
   * one of them. Both now call this one function; pin its exact shape so a
   * future edit to one field can't accidentally change what the OTHER
   * call site quietly assumes it still produces.
   */
  it("defaultDecumulationConfig matches the documented default shape", () => {
    const config = defaultDecumulationConfig();
    expect(config.withdrawalRoutingMode).toBe("bracket_filling");
    expect(config.withdrawalOrder).toEqual(getDefaultDecumulationOrder());
    expect(config.withdrawalSplits).toEqual(DEFAULT_WITHDRAWAL_SPLITS);
    for (const cat of categoriesWithTaxPreference()) {
      expect(config.withdrawalTaxPreference[cat]).toBe("traditional");
    }
  });
});

describe("buildCategoryRecord", () => {
  it("creates a record with all categories", () => {
    const rec = buildCategoryRecord(() => 0);
    for (const c of getAllCategories()) {
      expect(rec[c]).toBe(0);
    }
  });
});

describe("accountCategoryEnum", () => {
  it("returns a non-empty tuple for z.enum", () => {
    const tuple = accountCategoryEnum();
    expect(tuple.length).toBeGreaterThan(0);
    expect(tuple).toContain("401k");
  });
});

// ---------------------------------------------------------------------------
// Display labels
// ---------------------------------------------------------------------------

describe("display labels", () => {
  it("CONTRIBUTION_METHOD_LABELS covers all methods", () => {
    expect(CONTRIBUTION_METHOD_LABELS["percent_of_salary"]).toBe("% of Salary");
    expect(CONTRIBUTION_METHOD_LABELS["fixed_per_period"]).toBe("Fixed/Period");
  });

  it("CONTRIBUTION_METHOD_LABELS_SHORT covers all methods", () => {
    expect(CONTRIBUTION_METHOD_LABELS_SHORT["percent_of_salary"]).toBe(
      "% of salary",
    );
    expect(CONTRIBUTION_METHOD_LABELS_SHORT["fixed_annual"]).toBe("$/year");
  });

  it("TAX_TREATMENT_LABELS covers all treatments", () => {
    expect(TAX_TREATMENT_LABELS["pre_tax"]).toBe("Traditional");
    expect(TAX_TREATMENT_LABELS["hsa"]).toBe("HSA");
  });

  it("EMPLOYER_MATCH_LABELS covers all match types", () => {
    expect(EMPLOYER_MATCH_LABELS["none"]).toBe("None");
    expect(EMPLOYER_MATCH_LABELS["percent_of_contribution"]).toBe(
      "% of Contrib",
    );
  });

  it("displayLabel falls back to key for unknown entries", () => {
    expect(displayLabel(TAX_TREATMENT_LABELS, "unknown_type")).toBe(
      "unknown_type",
    );
  });
});

describe("Roth ordering rules / Rule of 55 config (Tax Buckets tool)", () => {
  it("401k and 403b use pro-rata ordering and are Rule-of-55 eligible", () => {
    expect(ACCOUNT_TYPE_CONFIG["401k"].rothOrderingRules).toBe("pro_rata");
    expect(ACCOUNT_TYPE_CONFIG["401k"].ruleOf55Eligible).toBe(true);
    expect(ACCOUNT_TYPE_CONFIG["403b"].rothOrderingRules).toBe("pro_rata");
    expect(ACCOUNT_TYPE_CONFIG["403b"].ruleOf55Eligible).toBe(true);
  });

  it("ira uses basis-first ordering and has no Rule-of-55 equivalent", () => {
    expect(ACCOUNT_TYPE_CONFIG.ira.rothOrderingRules).toBe("basis_first");
    expect(ACCOUNT_TYPE_CONFIG.ira.ruleOf55Eligible).toBe(false);
  });

  it("hsa and brokerage have no Roth ordering concept and no Rule of 55", () => {
    expect(ACCOUNT_TYPE_CONFIG.hsa.rothOrderingRules).toBeNull();
    expect(ACCOUNT_TYPE_CONFIG.hsa.ruleOf55Eligible).toBe(false);
    expect(ACCOUNT_TYPE_CONFIG.brokerage.rothOrderingRules).toBeNull();
    expect(ACCOUNT_TYPE_CONFIG.brokerage.ruleOf55Eligible).toBe(false);
  });

  it("tracksRothBasis mirrors tracksCostBasis for the roth_traditional structure", () => {
    expect(tracksRothBasis("401k")).toBe(true);
    expect(tracksRothBasis("403b")).toBe(true);
    expect(tracksRothBasis("ira")).toBe(true);
    expect(tracksRothBasis("hsa")).toBe(false);
    expect(tracksRothBasis("brokerage")).toBe(false);
    expect(tracksRothBasis("not_a_real_category")).toBe(false);
  });
});
