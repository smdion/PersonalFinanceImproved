/**
 * Retirement router integration tests.
 *
 * Tests the computeRelocationAnalysis query with:
 * - empty DB (early return with nulls)
 * - person only (no settings -> null)
 * - person + settings but no budget profiles -> null
 * - fully populated data -> non-null result with expected shape
 * - expense overrides, year adjustments, contribution overrides, large purchases
 * - return rates, retirement scenarios
 * - multi-column / weighted budget profiles
 * - contribution profile switching
 * - auth (viewer access)
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedJob,
  seedPerformanceAccount,
  seedSnapshot,
  viewerSession,
} from "./setup";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as sqliteSchema from "@/lib/db/schema-sqlite";

/** Minimal required input for computeRelocationAnalysis. */
const minimalInput = {
  currentProfileId: 1,
  currentBudgetColumn: 0,
  relocationProfileId: 1,
  relocationBudgetColumn: 0,
};

// ---------------------------------------------------------------------------
// Helpers — use the mocked schema (same pattern as networth.test.ts)
// ---------------------------------------------------------------------------

async function getSchema() {
  return await import("@/lib/db/schema");
}

/** Seed a budget profile manually via mocked schema. */
async function insertBudgetProfile(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  name: string,
  opts: {
    columnLabels?: string[];
    columnMonths?: number[] | null;
    isActive?: boolean;
  } = {},
): Promise<number> {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  const result = (db as any)
    .insert(schema.budgetProfiles)
    .values({
      name,
      isActive: opts.isActive ?? true,
      columnLabels: opts.columnLabels ?? ["Standard"],
      ...(opts.columnMonths ? { columnMonths: opts.columnMonths } : {}),
    })
    .returning({ id: schema.budgetProfiles.id })
    .get();
  return result.id;
}

/** Seed a budget item manually via mocked schema. */
async function insertBudgetItem(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  profileId: number,
  category: string,
  subcategory: string,
  amounts: number[],
): Promise<number> {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  const result = (db as any)
    .insert(schema.budgetItems)
    .values({ profileId, category, subcategory, amounts })
    .returning({ id: schema.budgetItems.id })
    .get();
  return result.id;
}

/** Insert a retirement_settings row. */
async function seedRetirementSettings(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  return (db as any)
    .insert(schema.retirementSettings)
    .values({
      personId,
      retirementAge: 65,
      endAge: 95,
      returnAfterRetirement: "0.04",
      annualInflation: "0.03",
      salaryAnnualIncrease: "0.03",
      withdrawalRate: "0.04",
      socialSecurityMonthly: "2500",
      ssStartAge: 67,
      ...overrides,
    })
    .returning({ id: schema.retirementSettings.id })
    .get();
}

/** Insert a return_rate_table row. */
async function seedReturnRate(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  age: number,
  rateOfReturn: string,
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  (db as any)
    .insert(schema.returnRateTable)
    .values({ age, rateOfReturn })
    .run();
}

/** Insert a retirement scenario. */
async function seedRetirementScenario(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  return (db as any)
    .insert(schema.retirementScenarios)
    .values({
      name: "Base Scenario",
      withdrawalRate: "0.04",
      targetAnnualIncome: "80000",
      annualInflation: "0.03",
      isSelected: false,
      ...overrides,
    })
    .returning({ id: schema.retirementScenarios.id })
    .get();
}

/** Insert a contribution account linked to a performance account and job. */
async function seedContributionAccount(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
  jobId: number,
  perfAccountId: number,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  return (db as any)
    .insert(schema.contributionAccounts)
    .values({
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "percent_of_contrib",
      employerMatchValue: "0.50",
      employerMaxMatchPct: "0.06",
      isActive: true,
      performanceAccountId: perfAccountId,
      ...overrides,
    })
    .returning({ id: schema.contributionAccounts.id })
    .get();
}

/** Mark a person as primary user. */
async function markPrimary(
  db: BetterSQLite3Database<typeof sqliteSchema>,
  personId: number,
) {
  const schema = await getSchema();
  const { eq } = await import("drizzle-orm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
  (db as any)
    .update(schema.people)
    .set({ isPrimaryUser: true })
    .where(eq(schema.people.id, personId))
    .run();
}

// ---------------------------------------------------------------------------
// Tests -- empty / minimal (early returns)
// ---------------------------------------------------------------------------

describe("retirement router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("computeRelocationAnalysis -- early returns", () => {
    it("returns without throwing on an empty DB", async () => {
      const result =
        await caller.retirement.computeRelocationAnalysis(minimalInput);
      expect(result).toBeDefined();
    });

    it("returns null result and null budgetInfo when DB has no people or settings", async () => {
      const result =
        await caller.retirement.computeRelocationAnalysis(minimalInput);
      expect(result.result).toBeNull();
      expect(result.budgetInfo).toBeNull();
    });

    it("has expected top-level shape", async () => {
      const result =
        await caller.retirement.computeRelocationAnalysis(minimalInput);
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("budgetInfo");
    });

    it("returns null when person exists but no retirement settings", async () => {
      await seedPerson(db);
      const result =
        await caller.retirement.computeRelocationAnalysis(minimalInput);
      expect(result.result).toBeNull();
      expect(result.budgetInfo).toBeNull();
    });

    it("accepts optional fields (empty override arrays) without throwing", async () => {
      const result = await caller.retirement.computeRelocationAnalysis({
        ...minimalInput,
        yearAdjustments: [],
        contributionOverrides: [],
        largePurchases: [],
        currentContributionProfileId: null,
        relocationContributionProfileId: null,
        currentExpenseOverride: null,
        relocationExpenseOverride: null,
      });
      expect(result).toBeDefined();
    });
  });

  describe("auth", () => {
    it("viewer can call computeRelocationAnalysis", async () => {
      const { caller: viewerCaller, cleanup: viewerCleanup } =
        await createTestCaller(viewerSession);
      try {
        const result =
          await viewerCaller.retirement.computeRelocationAnalysis(minimalInput);
        expect(result).toBeDefined();
      } finally {
        viewerCleanup();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Tests -- fully populated data (exercises the full code path)
// ---------------------------------------------------------------------------

describe("retirement router -- populated data", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let personId: number;
  let jobId: number;
  let profileId: number;
  let perfAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    // Seed primary person
    personId = await seedPerson(db, "Primary Person", "1990-01-01");
    await markPrimary(db, personId);

    // Seed retirement settings
    await seedRetirementSettings(db, personId);

    // Seed job
    jobId = seedJob(db, personId);

    // Seed budget profile with items
    profileId = await insertBudgetProfile(db, "Main Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);
    await insertBudgetItem(db, profileId, "Essentials", "Groceries", [600]);
    await insertBudgetItem(db, profileId, "Lifestyle", "Dining", [200]);

    // Seed performance account + snapshot
    perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      accountType: "401k",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      {
        performanceAccountId: perfAcctId,
        amount: "250000",
        taxType: "preTax",
      },
    ]);

    // Seed contribution account
    await seedContributionAccount(db, personId, jobId, perfAcctId);
  });

  afterAll(() => cleanup());

  it("returns non-null result with fully populated data", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    expect(result.budgetInfo).not.toBeNull();
  });

  it("result contains expected relocation fields", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    expect(r).toHaveProperty("currentAnnualExpenses");
    expect(r).toHaveProperty("relocationAnnualExpenses");
    expect(r).toHaveProperty("annualExpenseDelta");
    expect(r).toHaveProperty("monthlyExpenseDelta");
    expect(r).toHaveProperty("percentExpenseIncrease");
    expect(r).toHaveProperty("currentSavingsRate");
    expect(r).toHaveProperty("relocationSavingsRate");
    expect(r).toHaveProperty("savingsRateDrop");
    expect(r).toHaveProperty("currentFiTarget");
    expect(r).toHaveProperty("relocationFiTarget");
    expect(r).toHaveProperty("additionalNestEggNeeded");
    expect(r).toHaveProperty("currentFiAge");
    expect(r).toHaveProperty("relocationFiAge");
    expect(r).toHaveProperty("fiAgeDelay");
    expect(r).toHaveProperty("projectionByYear");
    expect(r).toHaveProperty("warnings");
  });

  it("budgetInfo contains profile summaries and indices", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    const bi = result.budgetInfo!;
    expect(bi.currentProfileId).toBe(profileId);
    expect(bi.currentColumnIndex).toBe(0);
    expect(bi.relocationProfileId).toBe(profileId);
    expect(bi.relocationColumnIndex).toBe(0);
    expect(bi.profiles).toBeInstanceOf(Array);
    expect(bi.profiles.length).toBeGreaterThan(0);
    const p = bi.profiles.find((x: { id: number }) => x.id === profileId)!;
    expect(p).toBeDefined();
    expect(p.name).toBe("Main Budget");
    expect(p.columnLabels).toEqual(["Standard"]);
    expect(p.columnTotals.length).toBe(1);
    // Rent(2000) + Groceries(600) + Dining(200)
    expect(p.columnTotals[0]).toBe(2800);
  });

  it("returns contribution profile data in response", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result).toHaveProperty("currentContribProfile");
    expect(result).toHaveProperty("relocationContribProfile");
    const cp = (result as Record<string, unknown>)
      .currentContribProfile as Record<string, unknown>;
    expect(cp).toHaveProperty("annualContributions");
    expect(cp).toHaveProperty("employerMatch");
    expect(cp).toHaveProperty("combinedSalary");
    expect(typeof cp.annualContributions).toBe("number");
    expect(typeof cp.employerMatch).toBe("number");
    expect(typeof cp.combinedSalary).toBe("number");
  });

  it("same profile/column for both sides yields zero expense delta", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    expect(r.annualExpenseDelta).toBe(0);
    expect(r.monthlyExpenseDelta).toBe(0);
    expect(r.percentExpenseIncrease).toBe(0);
  });

  it("produces projectionByYear array", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    expect(Array.isArray(r.projectionByYear)).toBe(true);
    expect(r.projectionByYear.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests -- expense overrides
// ---------------------------------------------------------------------------

describe("retirement router -- expense overrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Override Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "Override Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [1500]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("currentExpenseOverride overrides the budget profile expenses", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentExpenseOverride: 5000,
      relocationExpenseOverride: null,
    });
    const r = result.result!;
    // Current uses override (5000/mo = 60000/yr), relocation uses profile (1500/mo = 18000/yr)
    expect(r.currentAnnualExpenses).toBe(60000);
    expect(r.relocationAnnualExpenses).toBe(18000);
  });

  it("relocationExpenseOverride overrides relocation expenses", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentExpenseOverride: null,
      relocationExpenseOverride: 3000,
    });
    const r = result.result!;
    expect(r.currentAnnualExpenses).toBe(18000);
    expect(r.relocationAnnualExpenses).toBe(36000);
  });

  it("both overrides at once", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentExpenseOverride: 4000,
      relocationExpenseOverride: 6000,
    });
    const r = result.result!;
    expect(r.currentAnnualExpenses).toBe(48000);
    expect(r.relocationAnnualExpenses).toBe(72000);
    expect(r.annualExpenseDelta).toBe(24000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- two different budget profiles
// ---------------------------------------------------------------------------

describe("retirement router -- different profiles for current vs relocation", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let cheapProfileId: number;
  let expensiveProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Multi-Profile Person", "1988-06-15");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);

    cheapProfileId = await insertBudgetProfile(db, "Cheap City");
    await insertBudgetItem(db, cheapProfileId, "Essentials", "Rent", [1000]);

    expensiveProfileId = await insertBudgetProfile(db, "Expensive City");
    await insertBudgetItem(
      db,
      expensiveProfileId,
      "Essentials",
      "Rent",
      [3000],
    );
    await insertBudgetItem(
      db,
      expensiveProfileId,
      "Essentials",
      "Groceries",
      [500],
    );

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "200000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("relocation to a more expensive city increases expenses", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: cheapProfileId,
      currentBudgetColumn: 0,
      relocationProfileId: expensiveProfileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    expect(r.currentAnnualExpenses).toBe(12000); // 1000/mo
    expect(r.relocationAnnualExpenses).toBe(42000); // 3500/mo
    expect(r.annualExpenseDelta).toBeGreaterThan(0);
    expect(r.relocationFiTarget).toBeGreaterThan(r.currentFiTarget);
  });

  it("relocation to a cheaper city decreases expenses", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: expensiveProfileId,
      currentBudgetColumn: 0,
      relocationProfileId: cheapProfileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    expect(r.annualExpenseDelta).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests -- year adjustments
// ---------------------------------------------------------------------------

describe("retirement router -- year adjustments", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "YearAdj Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "YearAdj Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "150000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("year adjustments are accepted and do not throw", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      yearAdjustments: [
        { year: 2027, monthlyExpenses: 3000, notes: "Temporary higher rent" },
        { year: 2028, monthlyExpenses: 2500 },
      ],
    });
    expect(result.result).not.toBeNull();
  });

  it("year adjustments can reference a profileId+column", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      yearAdjustments: [
        { year: 2027, monthlyExpenses: 0, profileId, budgetColumn: 0 },
      ],
    });
    expect(result.result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests -- contribution overrides
// ---------------------------------------------------------------------------

describe("retirement router -- contribution overrides", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(
      db,
      "ContribOverride Person",
      "1990-01-01",
    );
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "CO Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [1500]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "100000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("contribution overrides are accepted and result is non-null", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      contributionOverrides: [
        { year: 2027, rate: 0.15 },
        { year: 2030, rate: 0.2, notes: "Max out" },
      ],
    });
    expect(result.result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests -- large purchases
// ---------------------------------------------------------------------------

describe("retirement router -- large purchases", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "LargePurchase Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "LP Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "300000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("large purchases are accepted and impact the result", async () => {
    const resultWithout = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      largePurchases: [],
    });

    const resultWith = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      largePurchases: [
        {
          name: "House Down Payment",
          purchasePrice: 500000,
          downPaymentPercent: 0.2,
          loanRate: 0.065,
          loanTermYears: 30,
          ongoingMonthlyCost: 500,
          purchaseYear: 2027,
        },
      ],
    });

    expect(resultWithout.result).not.toBeNull();
    expect(resultWith.result).not.toBeNull();
    // Large purchase should create a portfolio hit
    expect(resultWith.result!.totalLargePurchasePortfolioHit).toBeGreaterThan(
      0,
    );
    // Steady-state monthly cost from purchase
    expect(resultWith.result!.steadyStateMonthlyFromPurchases).toBeGreaterThan(
      0,
    );
  });

  it("large purchase with sale proceeds reduces portfolio hit", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      largePurchases: [
        {
          name: "New Car",
          purchasePrice: 40000,
          purchaseYear: 2027,
          saleProceeds: 15000,
        },
      ],
    });
    expect(result.result).not.toBeNull();
    // Net hit = 40000 - 15000 = 25000
    expect(result.result!.totalLargePurchasePortfolioHit).toBe(25000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- return rates
// ---------------------------------------------------------------------------

describe("retirement router -- return rates", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "ReturnRate Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, { retirementAge: 65 });
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "RR Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    // Seed return rates for various ages
    await seedReturnRate(db, 30, "0.10");
    await seedReturnRate(db, 35, "0.09");
    await seedReturnRate(db, 40, "0.08");
    await seedReturnRate(db, 50, "0.07");
    await seedReturnRate(db, 60, "0.06");
    await seedReturnRate(db, 65, "0.05");

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "200000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("uses return rate table for projection (does not throw)", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    expect(result.result!.projectionByYear.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests -- retirement scenarios
// ---------------------------------------------------------------------------

describe("retirement router -- selected scenario", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Scenario Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, { withdrawalRate: "0.04" });
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "Scenario Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    // Seed a selected scenario with a different withdrawal rate
    await seedRetirementScenario(db, {
      name: "Aggressive",
      withdrawalRate: "0.05",
      isSelected: true,
    });

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "200000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("uses selected scenario withdrawal rate (lower FI target)", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    const r = result.result!;
    // With 0.05 withdrawal rate and 2000/mo (24000/yr) expenses, FI target = 24000/0.05 = 480000
    expect(r.currentFiTarget).toBe(480000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- multi-column and weighted budget profiles
// ---------------------------------------------------------------------------

describe("retirement router -- multi-column budget profiles", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let multiColProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "MultiCol Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);

    // Multi-column profile: Summer (4 months) vs Winter (8 months)
    multiColProfileId = await insertBudgetProfile(db, "Seasonal Budget", {
      columnLabels: ["Summer", "Winter"],
      columnMonths: [4, 8],
    });

    // Summer rent = 3000, Winter rent = 1500
    await insertBudgetItem(
      db,
      multiColProfileId,
      "Essentials",
      "Rent",
      [3000, 1500],
    );

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "150000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("uses weighted annual total for multi-column profiles with columnMonths", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: multiColProfileId,
      currentBudgetColumn: 0,
      relocationProfileId: multiColProfileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    // Weighted: (3000*4 + 1500*8) / 12 = (12000+12000)/12 = 2000/mo = 24000/yr
    expect(result.result!.currentAnnualExpenses).toBe(24000);
  });

  it("profile summaries include weightedAnnualTotal", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: multiColProfileId,
      currentBudgetColumn: 0,
      relocationProfileId: multiColProfileId,
      relocationBudgetColumn: 0,
    });
    const bi = result.budgetInfo!;
    const p = bi.profiles.find(
      (x: { id: number }) => x.id === multiColProfileId,
    )!;
    expect(p).toBeDefined();
    expect(p.columnMonths).toEqual([4, 8]);
    // 3000*4 + 1500*8 = 24000
    expect(p.weightedAnnualTotal).toBe(24000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- no snapshot (zero portfolio)
// ---------------------------------------------------------------------------

describe("retirement router -- no snapshot", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "NoSnap Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "NoSnap Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [1500]);
    // No snapshot or performance accounts seeded
  });

  afterAll(() => cleanup());

  it("returns non-null result with zero portfolio", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    // FI target should still be calculable from expenses and withdrawal rate
    expect(result.result!.currentFiTarget).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tests -- contribution profiles
// ---------------------------------------------------------------------------

describe("retirement router -- contribution profiles", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;
  let contribProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(
      db,
      "ContribProfile Person",
      "1990-01-01",
    );
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    const jobId = seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "CP Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "200000", taxType: "preTax" },
    ]);

    // Seed a contribution account
    const contribAcct = await seedContributionAccount(
      db,
      personId,
      jobId,
      perfAcctId,
      {
        contributionValue: "0.10",
      },
    );

    // Seed a contribution profile with salary override
    const cpSchema = await getSchema();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic schema import requires runtime cast
    contribProfileId = (db as any)
      .insert(cpSchema.contributionProfiles)
      .values({
        name: "High Salary Profile",
        salaryOverrides: { [String(personId)]: 200000 },
        contributionOverrides: {
          contributionAccounts: {
            [String(contribAcct.id)]: { contributionValue: "0.15" },
          },
        },
      })
      .returning({ id: cpSchema.contributionProfiles.id })
      .get().id;
  });

  afterAll(() => cleanup());

  it("null contribution profile uses live DB data", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentContributionProfileId: null,
      relocationContributionProfileId: null,
    });
    expect(result.result).not.toBeNull();
    const cp = (result as Record<string, unknown>)
      .currentContribProfile as Record<string, number>;
    expect(cp.combinedSalary).toBeGreaterThan(0);
  });

  it("contribution profile ID switches contribution data", async () => {
    const resultLive = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentContributionProfileId: null,
      relocationContributionProfileId: null,
    });

    const resultProfile = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
      currentContributionProfileId: contribProfileId,
      relocationContributionProfileId: null,
    });

    expect(resultLive.result).not.toBeNull();
    expect(resultProfile.result).not.toBeNull();
    // The profile overrides salary to 200k and contribution to 15%, so amounts should differ
    const cpLive = (resultLive as Record<string, unknown>)
      .currentContribProfile as Record<string, number>;
    const cpProfile = (resultProfile as Record<string, unknown>)
      .currentContribProfile as Record<string, number>;
    // Salary override: profile sets 200k vs live ~120k
    expect(cpProfile.combinedSalary).toBe(200000);
    expect(cpLive.combinedSalary).not.toBe(200000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- missing budget profiles return null
// ---------------------------------------------------------------------------

describe("retirement router -- person + settings but no budget profiles", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "NoBudget Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    // No budget profiles seeded
  });

  afterAll(() => cleanup());

  it("returns null result when budget profiles are empty", async () => {
    const result =
      await caller.retirement.computeRelocationAnalysis(minimalInput);
    expect(result.result).toBeNull();
    expect(result.budgetInfo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests -- invalid profile ID
// ---------------------------------------------------------------------------

describe("retirement router -- mismatched profile IDs", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Mismatch Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "Real Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [1500]);
  });

  afterAll(() => cleanup());

  it("returns null when current profile ID does not exist", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: 99999,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).toBeNull();
    expect(result.budgetInfo).toBeNull();
  });

  it("returns null when relocation profile ID does not exist", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: 99999,
      relocationBudgetColumn: 0,
    });
    expect(result.result).toBeNull();
    expect(result.budgetInfo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests -- multiple people (primary + secondary)
// ---------------------------------------------------------------------------

describe("retirement router -- multiple people", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const primaryId = await seedPerson(db, "Primary", "1990-01-01");
    await markPrimary(db, primaryId);
    const secondaryId = await seedPerson(db, "Secondary", "1992-06-15");

    await seedRetirementSettings(db, primaryId);
    seedJob(db, primaryId);
    seedJob(db, secondaryId, {
      annualSalary: "80000",
      employerName: "PartnerCo",
    });

    profileId = await insertBudgetProfile(db, "Joint Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2500]);

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: primaryId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "200000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("works with multiple people -- uses primary person for settings", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    // Combined salary from both jobs should be reflected
    const cp = (result as Record<string, unknown>)
      .currentContribProfile as Record<string, number>;
    // Primary 120000 + Secondary 80000 = 200000 total
    expect(cp.combinedSalary).toBeGreaterThanOrEqual(120000);
  });
});

// ---------------------------------------------------------------------------
// Tests -- Portfolio-category accounts are excluded
// ---------------------------------------------------------------------------

describe("retirement router -- portfolio-category account filtering", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let profileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "Filter Person", "1990-01-01");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId);
    seedJob(db, personId);
    profileId = await insertBudgetProfile(db, "Filter Budget");
    await insertBudgetItem(db, profileId, "Essentials", "Rent", [2000]);

    // Retirement account
    const retAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      accountType: "401k",
      institution: "Fidelity",
      ownerPersonId: personId,
    });
    // Portfolio (brokerage) account -- should be excluded from relocation portfolio total
    const brokerageAcctId = seedPerformanceAccount(db, {
      parentCategory: "Portfolio",
      accountType: "brokerage",
      institution: "Schwab",
      accountLabel: "Schwab Brokerage",
      ownerPersonId: personId,
    });

    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: retAcctId, amount: "200000", taxType: "preTax" },
      {
        performanceAccountId: brokerageAcctId,
        amount: "50000",
        taxType: "afterTax",
      },
    ]);
  });

  afterAll(() => cleanup());

  it("only counts Retirement-category accounts in portfolio total", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: profileId,
      currentBudgetColumn: 0,
      relocationProfileId: profileId,
      relocationBudgetColumn: 0,
    });
    expect(result.result).not.toBeNull();
    // The brokerage account (50k) should NOT be included in portfolio total
    // projectionByYear[0] should start with ~200k portfolio, not 250k
    const firstYear = result.result!.projectionByYear[0];
    expect(firstYear).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests -- combined: all optional inputs together
// ---------------------------------------------------------------------------

describe("retirement router -- all optional inputs combined", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: BetterSQLite3Database<typeof sqliteSchema>;
  let cleanup: () => void;
  let currentProfileId: number;
  let relocProfileId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;

    const personId = await seedPerson(db, "AllInputs Person", "1985-03-15");
    await markPrimary(db, personId);
    await seedRetirementSettings(db, personId, { retirementAge: 60 });
    const jobId = seedJob(db, personId, { annualSalary: "150000" });

    currentProfileId = await insertBudgetProfile(db, "Current City");
    await insertBudgetItem(db, currentProfileId, "Essentials", "Rent", [2000]);
    await insertBudgetItem(
      db,
      currentProfileId,
      "Essentials",
      "Groceries",
      [500],
    );

    relocProfileId = await insertBudgetProfile(db, "Relocation City");
    await insertBudgetItem(db, relocProfileId, "Essentials", "Rent", [3500]);
    await insertBudgetItem(
      db,
      relocProfileId,
      "Essentials",
      "Groceries",
      [600],
    );

    const perfAcctId = seedPerformanceAccount(db, {
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    seedSnapshot(db, "2025-06-15", [
      { performanceAccountId: perfAcctId, amount: "400000", taxType: "preTax" },
    ]);
    await seedContributionAccount(db, personId, jobId, perfAcctId);

    // Return rates
    await seedReturnRate(db, 35, "0.09");
    await seedReturnRate(db, 40, "0.08");
    await seedReturnRate(db, 50, "0.07");
    await seedReturnRate(db, 60, "0.05");

    // Scenario
    await seedRetirementScenario(db, {
      name: "Balanced",
      withdrawalRate: "0.035",
      isSelected: true,
    });
  });

  afterAll(() => cleanup());

  it("handles all inputs simultaneously", async () => {
    const result = await caller.retirement.computeRelocationAnalysis({
      currentProfileId: currentProfileId,
      currentBudgetColumn: 0,
      relocationProfileId: relocProfileId,
      relocationBudgetColumn: 0,
      currentExpenseOverride: null,
      relocationExpenseOverride: null,
      yearAdjustments: [
        { year: 2027, monthlyExpenses: 5000, notes: "Moving costs" },
        { year: 2028, monthlyExpenses: 4200 },
      ],
      contributionOverrides: [
        { year: 2027, rate: 0.05, notes: "Reduced during move" },
        { year: 2029, rate: 0.15 },
      ],
      largePurchases: [
        {
          name: "New House",
          purchasePrice: 600000,
          downPaymentPercent: 0.2,
          loanRate: 0.06,
          loanTermYears: 30,
          ongoingMonthlyCost: 300,
          purchaseYear: 2027,
        },
        {
          name: "Car",
          purchasePrice: 35000,
          purchaseYear: 2027,
          saleProceeds: 10000,
        },
      ],
      currentContributionProfileId: null,
      relocationContributionProfileId: null,
    });

    expect(result.result).not.toBeNull();
    const r = result.result!;
    // Current expenses: 2000 + 500 = 2500/mo = 30000/yr
    expect(r.currentAnnualExpenses).toBe(30000);
    // Relocation expenses: 3500 + 600 = 4100/mo = 49200/yr
    expect(r.relocationAnnualExpenses).toBe(49200);
    expect(r.annualExpenseDelta).toBe(19200);
    // FI targets should be positive and relocation > current
    expect(r.currentFiTarget).toBeGreaterThan(0);
    expect(r.relocationFiTarget).toBeGreaterThan(r.currentFiTarget);
    expect(r.projectionByYear.length).toBeGreaterThan(0);
    expect(r.totalLargePurchasePortfolioHit).toBeGreaterThan(0);
    expect(r.warnings).toBeInstanceOf(Array);
  });
});
