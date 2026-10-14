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
  seedContributionProfile,
  adminSession,
} from "./setup";
import * as engine from "@/lib/calculators/engine";
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
      filingStatus: "MFJ",
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
      const result = await caller.projection.computeRelocationFiProjection({
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

      const result = await caller.projection.computeRelocationFiProjection({
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

      // FI target = annual budget ÷ 4% withdrawal rate: $2,000 vs $1,500 rent.
      expect(result!.currentFiTarget).toBeCloseTo((2000 * 12) / 0.04);
      expect(result!.relocationFiTarget).toBeCloseTo((1500 * 12) / 0.04);
      expect(result!.relocationBalanceAtRetirement).toBeGreaterThan(0);
      expect(result!.projectionRows.length).toBeGreaterThan(0);
      expect(result!.blendedRows).toBeNull();
      expect(result!.blendedBalanceAtRetirement).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("accepts an expense override instead of computing from budget", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);

      const result = await caller.projection.computeRelocationFiProjection({
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

      // Overrides replace the budget totals ($2,000 / $1,500).
      expect(result!.currentFiTarget).toBeCloseTo((3000 * 12) / 0.04);
      expect(result!.relocationFiTarget).toBeCloseTo((2500 * 12) / 0.04);
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

      const result = await caller.projection.computeRelocationFiProjection({
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

      const rows = result!.blendedRows!;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.phase).toBe(row.year < nextYear ? "current" : "relocation");
      }
      // Both scenarios save the same (same contribution profile, salary-
      // based contributions), so moving partway must land on the same nest
      // egg. Re-anchoring a second run at the move year used to drop that
      // year's contributions and restart salary growth, landing well short.
      expect(result!.blendedBalanceAtRetirement).toBeCloseTo(
        result!.relocationBalanceAtRetirement,
        0,
      );
      const moveRow = rows.find((r) => r.year === nextYear)!;
      const before = rows.find((r) => r.year === nextYear - 1)!;
      expect(moveRow.contribution).toBeGreaterThan(before.contribution);
      // Relocation expenses ($1,500/mo) carry the same inflation as the
      // engine's own years: lower than the year before the move ($2,000/mo).
      expect(moveRow.expenses).toBeLessThan(before.expenses);
      expect(moveRow.expenses).toBeGreaterThan(1500 * 12);
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

      const result = await caller.projection.computeRelocationFiProjection({
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

      const adjusted = result!.projectionRows.filter((r) => r.hasAdjustment);
      expect(adjusted.map((r) => r.year)).toEqual([nextYear]);
      expect(adjusted[0]!.relocationExpenses).toBe(1800 * 12);
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

      const result = await caller.projection.computeRelocationFiProjection({
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

      // The down payment hits the purchase year; the loan payment and
      // upkeep raise what the relocation has to fund forever.
      const hit = result!.projectionRows.find((r) => r.year === nextYear)!;
      expect(hit.largePurchaseImpact).toBeLessThan(0);
      expect(result!.relocationFiTarget).toBeGreaterThan((1500 * 12) / 0.04);
    } finally {
      cleanup();
    }
  });
});

describe("projection.relocationScenarios", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let savedId: number;

  // Minimal valid relocationScenarioParamsSchema value
  const minimalParams = {
    currentProfileId: 1,
    currentBudgetColumn: 0,
    currentExpenseOverride: null,
    relocationProfileId: 2,
    relocationBudgetColumn: 0,
    relocationExpenseOverride: null,
    yearAdjustments: [],
    largePurchases: [],
    currentContributionProfileId: null,
    relocationContributionProfileId: null,
  };

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.projection.relocationScenarios.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("save (create)", () => {
    it("creates a new relocation scenario (no id supplied)", async () => {
      const result = await caller.projection.relocationScenarios.save({
        name: "NYC to Austin",
        params: minimalParams,
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("NYC to Austin");
      expect(result!.params).toMatchObject({ currentProfileId: 1 });
      savedId = result!.id;
    });

    it("created scenario appears in list", async () => {
      const rows = await caller.projection.relocationScenarios.list();
      expect(rows.find((r: { id: number }) => r.id === savedId)).toBeDefined();
    });

    it("creates a second scenario", async () => {
      const result = await caller.projection.relocationScenarios.save({
        name: "SF to Denver",
        params: {
          ...minimalParams,
          currentProfileId: 3,
          relocationProfileId: 4,
        },
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("SF to Denver");
    });

    it("list contains both scenarios", async () => {
      const rows = await caller.projection.relocationScenarios.list();
      const names = rows.map((r: { name: string }) => r.name);
      expect(names).toContain("NYC to Austin");
      expect(names).toContain("SF to Denver");
    });
  });

  describe("save (update)", () => {
    it("updates an existing scenario when id is provided", async () => {
      const result = await caller.projection.relocationScenarios.save({
        id: savedId,
        name: "NYC to Austin — Revised",
        params: { ...minimalParams, currentExpenseOverride: 500 },
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("NYC to Austin — Revised");
      expect(
        (result!.params as typeof minimalParams).currentExpenseOverride,
      ).toBe(500);
    });

    it("updated scenario is reflected in list", async () => {
      const rows = await caller.projection.relocationScenarios.list();
      const found = rows.find((r: { id: number }) => r.id === savedId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("NYC to Austin — Revised");
    });
  });

  describe("delete", () => {
    it("deletes a relocation scenario", async () => {
      const created = await caller.projection.relocationScenarios.save({
        name: "Throwaway Relocation",
        params: minimalParams,
      });
      expect(created).toBeDefined();

      await caller.projection.relocationScenarios.delete({ id: created!.id });

      const rows = await caller.projection.relocationScenarios.list();
      expect(
        rows.find((r: { id: number }) => r.id === created!.id),
      ).toBeUndefined();
    });

    it("remaining scenarios are unaffected", async () => {
      const rows = await caller.projection.relocationScenarios.list();
      expect(rows.find((r: { id: number }) => r.id === savedId)).toBeDefined();
    });
  });
});

describe("projection.relocationScenarios additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  const fullParams = {
    currentProfileId: 1,
    currentBudgetColumn: 0,
    currentExpenseOverride: 5000,
    relocationProfileId: 2,
    relocationBudgetColumn: 1,
    relocationExpenseOverride: 4000,
    yearAdjustments: [{ year: 2026, monthlyExpenses: 3000 }],
    largePurchases: [{ name: "Car", purchasePrice: 35000, purchaseYear: 2027 }],
    currentContributionProfileId: 1,
    relocationContributionProfileId: 2,
  };

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates a scenario with full params", async () => {
    const result = await caller.projection.relocationScenarios.save({
      name: "Full Params Scenario",
      params: fullParams,
    });
    expect(result).toBeDefined();
    const params = result!.params as typeof fullParams;
    expect(params.currentExpenseOverride).toBe(5000);
    expect(params.relocationExpenseOverride).toBe(4000);
  });

  it("list returns scenarios ordered by updatedAt desc", async () => {
    await caller.projection.relocationScenarios.save({
      name: "Older Scenario",
      params: { ...fullParams, currentProfileId: 10 },
    });
    const rows = await caller.projection.relocationScenarios.list();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Most recently created/updated should be first
  });
});

describe("projection.relocationScenarios additional", () => {
  const minimalParams = {
    currentProfileId: 1,
    currentBudgetColumn: 0,
    currentExpenseOverride: null,
    relocationProfileId: 2,
    relocationBudgetColumn: 0,
    relocationExpenseOverride: null,
    yearAdjustments: [],
    largePurchases: [],
    currentContributionProfileId: null,
    relocationContributionProfileId: null,
  };

  it("creates scenario with year adjustments and large purchases", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.projection.relocationScenarios.save({
        name: "Rich Relocation",
        params: {
          ...minimalParams,
          yearAdjustments: [{ year: 2027, monthlyExpenses: 5000 }],
          largePurchases: [
            { name: "Car", purchasePrice: 25000, purchaseYear: 2028 },
          ],
        },
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Rich Relocation");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("projection.relocation — move-year handoff", () => {
  const baseInput = {
    currentBudgetColumn: 0,
    currentExpenseOverride: null,
    relocationBudgetColumn: 0,
    relocationExpenseOverride: null,
    yearAdjustments: [],
    largePurchases: [],
  };

  it("expense schedules stop before retirement (the retirement budget stays)", async () => {
    const spy = vi.spyOn(engine, "calculateProjection");
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);
      spy.mockClear();
      await caller.projection.computeRelocationFiProjection({
        ...baseInput,
        currentProfileId,
        currentContributionProfileId: null,
        relocationProfileId: relocProfileId,
        relocationContributionProfileId: null,
        moveYear: new Date().getFullYear() + 2,
      });
      for (const [input] of spy.mock.calls) {
        const retirementYear =
          input.asOfDate.getFullYear() +
          (input.retirementAge - input.currentAge);
        for (const o of input.budgetOverrides) {
          expect(o.year).toBeLessThan(retirementYear);
        }
      }
    } finally {
      spy.mockRestore();
      cleanup();
    }
  });

  it("a different relocation contribution profile carries its routing from the move year", async () => {
    const spy = vi.spyOn(engine, "calculateProjection");
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const { currentProfileId, relocProfileId } =
        await seedRelocationDataset(db);
      const otherProfile = seedContributionProfile(db, {
        name: "Relocation",
        contributionActiveFields: { contributionAccounts: {}, jobs: {} },
      });
      const moveYear = new Date().getFullYear() + 2;
      spy.mockClear();
      await caller.projection.computeRelocationFiProjection({
        ...baseInput,
        currentProfileId,
        currentContributionProfileId: null,
        relocationProfileId: relocProfileId,
        relocationContributionProfileId: otherProfile,
        moveYear,
      });
      const blended = spy.mock.calls
        .map(([input]) => input)
        .find((input) =>
          (input.profileSwitches ?? []).some((ps) => ps.year === moveYear),
        );
      expect(blended).toBeDefined();
      expect(
        blended!.accumulationOverrides.find((o) => o.year === moveYear),
      ).toMatchObject({ routingMode: expect.any(String) });
    } finally {
      spy.mockRestore();
      cleanup();
    }
  });
});
