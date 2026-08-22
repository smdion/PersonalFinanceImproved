/**
 * Integration tests for Zod input schemas used by tRPC routers.
 *
 * These tests import the actual Zod schemas and verify they correctly
 * validate/reject inputs — no database or server required.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import {
  columnLabelsSchema,
  columnMonthsSchema,
  columnContributionProfileIdsSchema,
  budgetAmountsSchema,
  settingValueSchema,
  salaryEntriesSchema,
  extraPaycheckRoutingSchema,
  contributionActiveFieldsSchema,
  contribAccountActiveFieldsSchema,
  deductionActiveFieldsSchema,
  taxBracketEntrySchema,
  taxBracketsSchema,
  accountMappingSchema,
  relocationScenarioParamsSchema,
} from "@/lib/db/json-schemas";

// ── Budget Item Creation Schemas ──────────────────────────────────

describe("budget createItem input schema", () => {
  // Reproduce the schema from the budget router
  const createItemSchema = z.object({
    category: z.string().trim().min(1),
    subcategory: z.string().trim().min(1),
    isEssential: z.boolean().default(true),
  });

  it("accepts valid input", () => {
    const result = createItemSchema.safeParse({
      category: "Housing",
      subcategory: "Rent",
      isEssential: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("Housing");
      expect(result.data.subcategory).toBe("Rent");
      expect(result.data.isEssential).toBe(false);
    }
  });

  it("trims whitespace from category and subcategory", () => {
    const result = createItemSchema.safeParse({
      category: "  Housing  ",
      subcategory: "  Rent  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("Housing");
      expect(result.data.subcategory).toBe("Rent");
    }
  });

  it("defaults isEssential to true when omitted", () => {
    const result = createItemSchema.safeParse({
      category: "Food",
      subcategory: "Groceries",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isEssential).toBe(true);
    }
  });

  it("rejects empty category", () => {
    const result = createItemSchema.safeParse({
      category: "",
      subcategory: "Rent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only category", () => {
    const result = createItemSchema.safeParse({
      category: "   ",
      subcategory: "Rent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty subcategory", () => {
    const result = createItemSchema.safeParse({
      category: "Housing",
      subcategory: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing category field", () => {
    const result = createItemSchema.safeParse({
      subcategory: "Rent",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string category", () => {
    const result = createItemSchema.safeParse({
      category: 123,
      subcategory: "Rent",
    });
    expect(result.success).toBe(false);
  });
});

// ── Column Labels Schema ──────────────────────────────────────────

describe("columnLabelsSchema", () => {
  it("accepts non-empty array of non-empty strings", () => {
    const result = columnLabelsSchema.safeParse(["Standard", "Aggressive"]);
    expect(result.success).toBe(true);
  });

  it("rejects empty array", () => {
    const result = columnLabelsSchema.safeParse([]);
    expect(result.success).toBe(false);
  });

  it("rejects array with empty string", () => {
    const result = columnLabelsSchema.safeParse(["Valid", ""]);
    expect(result.success).toBe(false);
  });

  it("rejects non-array", () => {
    const result = columnLabelsSchema.safeParse("not an array");
    expect(result.success).toBe(false);
  });
});

// ── Column Months Schema ─────────────────────────────────────────

describe("columnMonthsSchema", () => {
  it("accepts array of non-negative numbers", () => {
    const result = columnMonthsSchema.safeParse([6, 3, 3]);
    expect(result.success).toBe(true);
  });

  it("accepts null", () => {
    const result = columnMonthsSchema.safeParse(null);
    expect(result.success).toBe(true);
  });

  it("rejects negative months", () => {
    const result = columnMonthsSchema.safeParse([6, -1]);
    expect(result.success).toBe(false);
  });

  it("rejects non-number elements", () => {
    const result = columnMonthsSchema.safeParse([6, "three"]);
    expect(result.success).toBe(false);
  });
});

// ── Column Contribution Profile IDs Schema ───────────────────────

describe("columnContributionProfileIdsSchema", () => {
  it("accepts array of nullable integers", () => {
    const result = columnContributionProfileIdsSchema.safeParse([1, null, 3]);
    expect(result.success).toBe(true);
  });

  it("accepts null", () => {
    const result = columnContributionProfileIdsSchema.safeParse(null);
    expect(result.success).toBe(true);
  });

  it("rejects non-integer numbers", () => {
    const result = columnContributionProfileIdsSchema.safeParse([1.5]);
    expect(result.success).toBe(false);
  });
});

// ── Budget Amounts Schema ────────────────────────────────────────

describe("budgetAmountsSchema", () => {
  it("accepts array of numbers", () => {
    const result = budgetAmountsSchema.safeParse([100, 200, 0]);
    expect(result.success).toBe(true);
  });

  it("accepts empty array", () => {
    const result = budgetAmountsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects non-number elements", () => {
    const result = budgetAmountsSchema.safeParse([100, "two hundred"]);
    expect(result.success).toBe(false);
  });
});

// ── Setting Value Schema ─────────────────────────────────────────

describe("settingValueSchema", () => {
  it("accepts string", () => {
    expect(settingValueSchema.safeParse("hello").success).toBe(true);
  });

  it("accepts number", () => {
    expect(settingValueSchema.safeParse(42).success).toBe(true);
  });

  it("accepts boolean", () => {
    expect(settingValueSchema.safeParse(true).success).toBe(true);
  });

  it("accepts null", () => {
    expect(settingValueSchema.safeParse(null).success).toBe(true);
  });

  it("accepts record object", () => {
    expect(settingValueSchema.safeParse({ key: "value" }).success).toBe(true);
  });

  it("accepts array", () => {
    expect(settingValueSchema.safeParse([1, 2, 3]).success).toBe(true);
  });
});

// ── Contribution Profile Schemas ─────────────────────────────────

describe("salaryEntriesSchema", () => {
  const complete = (overrides: Record<string, unknown> = {}) => ({
    salary: 120000,
    bonusPercent: 0.1,
    bonusMultiplier: 1,
    monthsInBonusYear: 12,
    bonusOverride: null,
    payPeriod: "biweekly",
    payWeek: "na",
    anchorPayDate: null,
    budgetPeriodsPerMonth: null,
    w4FilingStatus: "MFJ",
    w4Box2cChecked: false,
    additionalFedWithholding: 0,
    bonusMonth: null,
    bonusDayOfMonth: null,
    include401kInBonus: false,
    includeBonusInContributions: true,
    extraPaycheckRouting: null,
    ...overrides,
  });

  it("accepts a complete entry — all seventeen fields required", () => {
    const result = salaryEntriesSchema.safeParse({
      "1": complete(),
      "4": complete({ salary: 200000, bonusPercent: 0.2 }),
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object — a profile that mentions no jobs", () => {
    const result = salaryEntriesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects a bare number — the old sparse shape is no longer valid", () => {
    const result = salaryEntriesSchema.safeParse({ "1": 120000 });
    expect(result.success).toBe(false);
  });

  it("rejects a partial entry — entries are all-or-nothing, no partial pins", () => {
    expect(salaryEntriesSchema.safeParse({ "1": {} }).success).toBe(false);
    expect(
      salaryEntriesSchema.safeParse({ "1": { salary: 120000 } }).success,
    ).toBe(false);
    expect(
      salaryEntriesSchema.safeParse({ "1": { bonusPercent: 0.15 } }).success,
    ).toBe(false);
  });

  it("rejects the old {mode:...} discriminator outright", () => {
    // .strict() matters here: without it a stale client payload would be
    // accepted, stored, and then silently ignored by every reader.
    expect(
      salaryEntriesSchema.safeParse({ "1": { mode: "job" } }).success,
    ).toBe(false);
    expect(
      salaryEntriesSchema.safeParse({ "1": { mode: "fixed", salary: 1 } })
        .success,
    ).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = salaryEntriesSchema.safeParse({
      "1": complete({ bonusPercentage: 0.1 }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-number salary", () => {
    const result = salaryEntriesSchema.safeParse({
      "1": complete({ salary: "not a number" }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-number bonus terms", () => {
    expect(
      salaryEntriesSchema.safeParse({ "1": complete({ bonusPercent: "0.1" }) })
        .success,
    ).toBe(false);
    expect(
      salaryEntriesSchema.safeParse({
        "1": complete({ bonusMultiplier: null }),
      }).success,
    ).toBe(false);
  });

  it("accepts extraPaycheckRouting: null — a complete 'no routing configured' entry", () => {
    const result = salaryEntriesSchema.safeParse({
      "1": complete({ extraPaycheckRouting: null }),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an entry missing extraPaycheckRouting entirely", () => {
    const { extraPaycheckRouting: _drop, ...withoutRouting } = complete();
    expect(salaryEntriesSchema.safeParse({ "1": withoutRouting }).success).toBe(
      false,
    );
  });
});

describe("extraPaycheckRoutingSchema", () => {
  const validRouting = {
    rules: [
      {
        from: "2026-01",
        to: null,
        splits: [{ goalId: 1, pct: 100 }],
      },
    ],
  };

  it("accepts a minimal valid routing blob (rules only)", () => {
    expect(extraPaycheckRoutingSchema.safeParse(validRouting).success).toBe(
      true,
    );
  });

  it("accepts a fully-populated routing blob", () => {
    const result = extraPaycheckRoutingSchema.safeParse({
      rules: [
        {
          from: "2026-01",
          to: "2026-12",
          splits: [
            { goalId: 1, pct: 60 },
            { goalId: 2, pct: 40 },
          ],
          netPaySnapshot: 1000,
        },
      ],
      overrides: [{ month: "2026-06", splits: [{ goalId: 1, pct: 100 }] }],
      baseNetPayPerCheck: 1000,
      baseYear: 2026,
      yearlyGrowth: { "2027": { type: "pct", value: 3 } },
      payPeriod: "biweekly",
      anchorPayDate: "2026-01-02",
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects splits missing a required field", () => {
    expect(
      extraPaycheckRoutingSchema.safeParse({
        rules: [{ from: "2026-01", to: null, splits: [{ goalId: 1 }] }],
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid payPeriod value", () => {
    expect(
      extraPaycheckRoutingSchema.safeParse({
        ...validRouting,
        payPeriod: "fortnightly",
      }).success,
    ).toBe(false);
  });

  it("rejects a malformed yearlyGrowth entry (missing value)", () => {
    expect(
      extraPaycheckRoutingSchema.safeParse({
        ...validRouting,
        yearlyGrowth: { "2027": { type: "pct" } },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown top-level fields", () => {
    expect(
      extraPaycheckRoutingSchema.safeParse({
        ...validRouting,
        unknownField: true,
      }).success,
    ).toBe(false);
  });

  it("rejects missing rules array", () => {
    expect(extraPaycheckRoutingSchema.safeParse({}).success).toBe(false);
  });
});

describe("contribAccountActiveFieldsSchema", () => {
  it("accepts valid active fields with contribution fields", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({
      contributionValue: 500,
      contributionMethod: "fixed_monthly",
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (all fields optional)", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts string contribution values (percent notation)", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({
      contributionValue: "10",
      contributionMethod: "percent_of_salary",
      employerMatchValue: "6",
      employerMaxMatchPct: "4",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({
      unknownField: "bad",
    });
    expect(result.success).toBe(false);
  });

  it("accepts autoMaximize boolean", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({
      autoMaximize: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts displayNameActive", () => {
    const result = contribAccountActiveFieldsSchema.safeParse({
      displayNameActive: "My Custom Name",
    });
    expect(result.success).toBe(true);
  });
});

// jobActiveFieldsSchema no longer exists — the Contribution Profile `jobs`
// active-fields bucket is deleted wholesale (Stage B). Pay schedule, W-4
// elections, and bonus pay date/flags all moved to the Salary Profile
// entry (see salaryEntriesSchema above); employerName has no
// profile-override path at all any more.

describe("deductionActiveFieldsSchema", () => {
  it("accepts a valid amountPerPeriod", () => {
    const result = deductionActiveFieldsSchema.safeParse({
      amountPerPeriod: "25.00",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    expect(deductionActiveFieldsSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = deductionActiveFieldsSchema.safeParse({
      deductionName: "Dental", // structural-only, not profile-settable
    });
    expect(result.success).toBe(false);
  });
});

describe("contributionActiveFieldsSchema", () => {
  it("accepts valid nested structure", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {
        "5": {
          contributionValue: 1000,
          contributionMethod: "fixed_annual",
          isActive: true,
        },
        "12": { contributionMethod: "percent_gross", contributionValue: 500 },
      },
      deductions: {
        "1": { amountPerPeriod: "12.50" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("defaults to empty objects when omitted", () => {
    const result = contributionActiveFieldsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contributionAccounts).toEqual({});
      expect(result.data.deductions).toEqual({});
    }
  });

  it("applies defaults when called with undefined", () => {
    const result = contributionActiveFieldsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        contributionAccounts: {},
        deductions: {},
      });
    }
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {},
      jobs: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested contribution account active fields", () => {
    const result = contributionActiveFieldsSchema.safeParse({
      contributionAccounts: {
        "5": { unknownField: "bad" },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ── Tax Bracket Schemas ──────────────────────────────────────────

describe("taxBracketsSchema", () => {
  it("accepts valid bracket entries", () => {
    const result = taxBracketsSchema.safeParse([
      { threshold: 0, baseWithholding: 0, rate: 0.1 },
      { threshold: 10000, baseWithholding: 1000, rate: 0.12 },
      { threshold: 40000, baseWithholding: 4600, rate: 0.22 },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts empty array", () => {
    expect(taxBracketsSchema.safeParse([]).success).toBe(true);
  });

  it("rejects entry missing required fields", () => {
    const result = taxBracketsSchema.safeParse([
      { threshold: 0, rate: 0.1 }, // missing baseWithholding
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects non-number threshold", () => {
    const result = taxBracketEntrySchema.safeParse({
      threshold: "zero",
      baseWithholding: 0,
      rate: 0.1,
    });
    expect(result.success).toBe(false);
  });
});

// ── Account Mapping Schema ───────────────────────────────────────

describe("accountMappingSchema", () => {
  it("accepts valid mapping", () => {
    const result = accountMappingSchema.safeParse({
      localName: "Checking",
      remoteAccountId: "abc-123",
      syncDirection: "pull",
    });
    expect(result.success).toBe(true);
  });

  it("accepts mapping with optional fields", () => {
    const result = accountMappingSchema.safeParse({
      localId: "local-1",
      localName: "Savings",
      remoteAccountId: "xyz-456",
      syncDirection: "both",
      assetId: 5,
      loanId: 10,
      loanMapType: "loanBalance",
      performanceAccountId: 3,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid syncDirection", () => {
    const result = accountMappingSchema.safeParse({
      localName: "Checking",
      remoteAccountId: "abc",
      syncDirection: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing remoteAccountId", () => {
    const result = accountMappingSchema.safeParse({
      localName: "Checking",
      syncDirection: "pull",
    });
    expect(result.success).toBe(false);
  });
});

// ── Relocation Scenario Params Schema ────────────────────────────

describe("relocationScenarioParamsSchema", () => {
  const validParams = {
    currentProfileId: 1,
    currentBudgetColumn: 0,
    currentExpenseOverride: null,
    relocationProfileId: 2,
    relocationBudgetColumn: 1,
    relocationExpenseOverride: 5000,
    yearAdjustments: [],
    largePurchases: [],
    currentContributionProfileId: null,
    relocationContributionProfileId: 3,
  };

  it("accepts valid params", () => {
    const result = relocationScenarioParamsSchema.safeParse(validParams);
    expect(result.success).toBe(true);
  });

  it("accepts params with year adjustments", () => {
    const result = relocationScenarioParamsSchema.safeParse({
      ...validParams,
      yearAdjustments: [
        { year: 2027, monthlyExpenses: 4000, notes: "Post-move" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts params with large purchases", () => {
    const result = relocationScenarioParamsSchema.safeParse({
      ...validParams,
      largePurchases: [
        {
          name: "New House",
          purchasePrice: 500000,
          downPaymentPercent: 20,
          loanRate: 6.5,
          loanTermYears: 30,
          purchaseYear: 2027,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = relocationScenarioParamsSchema.safeParse({
      currentProfileId: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-number profile IDs", () => {
    const result = relocationScenarioParamsSchema.safeParse({
      ...validParams,
      currentProfileId: "one",
    });
    expect(result.success).toBe(false);
  });
});
