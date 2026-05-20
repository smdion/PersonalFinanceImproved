/**
 * Relocation projection router coverage tests.
 *
 * Tests the computeRelocationFiProjection procedure with a seeded DB
 * to drive coverage of the router logic (profile resolution, expense
 * computation, engine calls, blended path, binary search, etc.).
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import {
  createTestCaller,
  seedStandardDataset,
  seedBudgetProfile,
  seedBudgetItem,
  adminSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";
import * as schema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedRetirementSettings(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
) {
  db.insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 90,
      returnAfterRetirement: "0.05",
      annualInflation: "0.03",
      postRetirementInflation: "0.025",
      salaryAnnualIncrease: "0.02",
      withdrawalRate: "0.04",
      taxMultiplier: "1.0",
      grossUpForTaxes: true,
      withdrawalStrategy: "fixed",
      gkSkipInflationAfterLoss: true,
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      enableRothConversions: false,
      enableIrmaaAwareness: false,
      enableAcaAwareness: false,
      householdSize: 2,
    })
    .run();
}

function seedReturnRates(db: BetterSQLite3Database<typeof sqliteSchema>) {
  db.insert(schema.returnRateTable)
    .values({ age: 35, rateOfReturn: "0.07" })
    .run();
  db.insert(schema.returnRateTable)
    .values({ age: 65, rateOfReturn: "0.05" })
    .run();
}

function seedContributionAccount(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  perfAcctId: number,
) {
  db.insert(schema.contributionAccounts)
    .values({
      accountType: "401k",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      taxTreatment: "pre_tax",
      employerMatchType: "none",
      isActive: true,
      personId,
      performanceAccountId: perfAcctId,
      parentCategory: "Retirement",
    })
    .run();
}

async function seedRelocationDataset(
  db: BetterSQLite3Database<typeof sqliteSchema>,
) {
  const { personId, perfAcctId } = seedStandardDataset(db);
  seedRetirementSettings(db, personId);
  seedReturnRates(db);
  seedContributionAccount(db, personId, perfAcctId);

  const currentProfileId = await seedBudgetProfile(db, "Current City");
  seedBudgetItem(db, currentProfileId, {
    category: "Housing",
    subcategory: "Rent",
    amounts: [2000],
  });

  const relocProfileId = await seedBudgetProfile(db, "New City");
  seedBudgetItem(db, relocProfileId, {
    category: "Housing",
    subcategory: "Rent",
    amounts: [1500],
  });

  return { currentProfileId, relocProfileId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("projection.relocation — computeRelocationFiProjection", () => {
  it("returns null when profile IDs are not found", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId: 9999,
          currentBudgetColumn: 0,
          currentExpenseOverride: null,
          currentContributionProfileId: null,
          relocationProfileId: 9998,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: null,
          relocationContributionProfileId: null,
          yearAdjustments: [],
          largePurchases: [],
          moveYear: null,
        });
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns projection result shape with valid profiles and retirement settings", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);

      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId,
          currentBudgetColumn: 0,
          currentExpenseOverride: null,
          currentContributionProfileId: null,
          relocationProfileId: relocProfileId,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: null,
          relocationContributionProfileId: null,
          yearAdjustments: [],
          largePurchases: [],
          moveYear: null,
        });

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("currentBalanceAtRetirement");
      expect(result).toHaveProperty("relocationBalanceAtRetirement");
      expect(result).toHaveProperty("projectionRows");
      expect(result).toHaveProperty("inflationRate");
      expect(result).toHaveProperty("baseYear");
      expect(Array.isArray(result!.projectionRows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("accepts an expense override instead of computing from budget", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);

      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId,
          currentBudgetColumn: 0,
          currentExpenseOverride: 3000,
          currentContributionProfileId: null,
          relocationProfileId: relocProfileId,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: 2500,
          relocationContributionProfileId: null,
          yearAdjustments: [],
          largePurchases: [],
          moveYear: null,
        });

      expect(result).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns blended rows when moveYear is set", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);
      const nextYear = new Date().getFullYear() + 2;

      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId,
          currentBudgetColumn: 0,
          currentExpenseOverride: null,
          currentContributionProfileId: null,
          relocationProfileId: relocProfileId,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: null,
          relocationContributionProfileId: null,
          yearAdjustments: [],
          largePurchases: [],
          moveYear: nextYear,
        });

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("blendedRows");
      expect(Array.isArray(result!.blendedRows)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("applies year adjustments to relocation expenses", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);
      const nextYear = new Date().getFullYear() + 1;

      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId,
          currentBudgetColumn: 0,
          currentExpenseOverride: null,
          currentContributionProfileId: null,
          relocationProfileId: relocProfileId,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: null,
          relocationContributionProfileId: null,
          yearAdjustments: [{ year: nextYear, monthlyExpenses: 1800 }],
          largePurchases: [],
          moveYear: null,
        });

      expect(result).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("handles large purchases with loan parameters", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);
      const nextYear = new Date().getFullYear() + 1;

      const result =
        await caller.projection.computeRelocationFiProjection({
          currentProfileId,
          currentBudgetColumn: 0,
          currentExpenseOverride: null,
          currentContributionProfileId: null,
          relocationProfileId: relocProfileId,
          relocationBudgetColumn: 0,
          relocationExpenseOverride: null,
          relocationContributionProfileId: null,
          yearAdjustments: [],
          largePurchases: [
            {
              purchaseYear: nextYear,
              purchasePrice: 300000,
              downPaymentPercent: 0.2,
              loanRate: 0.065,
              loanTermYears: 30,
              ongoingMonthlyCost: 300,
              saleProceeds: null,
            },
          ],
          moveYear: null,
        });

      expect(result).not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
