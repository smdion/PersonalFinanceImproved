/**
 * Budget router coverage tests — covers procedures and branches not exercised
 * by the primary budget.test.ts suite.
 *
 * Covers: updateItemAmounts, updateCategoryEssential, updateColumnContributionProfileIds,
 * linkContributionAccount, unlinkContributionAccount, listContribAccountsForLinking,
 * listApiCategories, syncBudgetFromApi, syncBudgetToApi, listApiActuals,
 * addColumn/removeColumn with columnMonths + contribProfileIds,
 * computeActiveSummary with contribution-linked items,
 * listProfiles with weighted columnMonths.
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestCaller,
  seedStandardDataset,
  seedBudgetProfile,
  adminSession,
  seedPerformanceAccount,
  seedContributionProfile,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
  refreshCategoryCache: vi.fn().mockResolvedValue(undefined),
  YNAB_INTERNAL_GROUPS: new Set([
    "Internal Master Category",
    "Credit Card Payments",
  ]),
}));

async function getSchema() {
  return await import("@/lib/db/schema");
}

type TestDb = Awaited<ReturnType<typeof createTestCaller>>["db"];

/**
 * Insert a contribution account directly (the setup.ts helper has wrong column names).
 */
async function seedContribAccount(
  db: TestDb,
  personId: number,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  return db
    .insert(schema.contributionAccounts)
    .values({
      personId,
      jobId: null,
      accountType: "roth_ira",
      parentCategory: "Retirement",
      taxTreatment: "roth",
      contributionMethod: "dollar_amount",
      contributionValue: "500",
      employerMatchType: "none",
      isActive: true,
      ownership: "individual",
      ...overrides,
    })
    .returning({ id: schema.contributionAccounts.id })
    .get();
}

/**
 * Insert a contribution account with jobId for payroll-linked tests.
 */
async function seedPayrollContribAccount(
  db: TestDb,
  personId: number,
  jobId: number,
  overrides: Record<string, unknown> = {},
) {
  const schema = await getSchema();
  return db
    .insert(schema.contributionAccounts)
    .values({
      personId,
      jobId,
      accountType: "401k",
      parentCategory: "Retirement",
      taxTreatment: "pre_tax",
      contributionMethod: "percent_of_salary",
      contributionValue: "0.10",
      employerMatchType: "none",
      isActive: true,
      ownership: "individual",
      ...overrides,
    })
    .returning({ id: schema.contributionAccounts.id })
    .get();
}

// ---------------------------------------------------------------------------
// updateItemAmounts (batch)
// ---------------------------------------------------------------------------

describe("budget router — updateItemAmounts", () => {
  it("batch updates multiple item amounts in one call", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const result = await caller.budget.updateItemAmounts({
        updates: [
          { id: seed.itemIds[0]!, colIndex: 0, amount: 1111 },
          { id: seed.itemIds[1]!, colIndex: 0, amount: 2222 },
        ],
      });
      expect(result).toEqual({ ok: true });

      // Verify amounts changed
      const summary = await caller.budget.computeActiveSummary();
      const item0 = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      const item1 = summary.rawItems!.find((i) => i.id === seed.itemIds[1]!);
      expect((item0!.amounts as number[])[0]).toBe(1111);
      expect((item1!.amounts as number[])[0]).toBe(2222);
    } finally {
      cleanup();
    }
  });

  it("skips non-existent items without throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateItemAmounts({
        updates: [{ id: 999999, colIndex: 0, amount: 100 }],
      });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });

  it("skips out-of-bounds colIndex without throwing", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const result = await caller.budget.updateItemAmounts({
        updates: [{ id: seed.itemIds[0]!, colIndex: 99, amount: 100 }],
      });
      expect(result).toEqual({ ok: true });

      // Amount should be unchanged
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect((item!.amounts as number[])[0]).toBe(2000); // original seed value
    } finally {
      cleanup();
    }
  });

  it("handles multiple updates to the same item", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // Two updates to same item — second should win
      const result = await caller.budget.updateItemAmounts({
        updates: [
          { id: seed.itemIds[0]!, colIndex: 0, amount: 100 },
          { id: seed.itemIds[0]!, colIndex: 0, amount: 200 },
        ],
      });
      expect(result).toEqual({ ok: true });

      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect((item!.amounts as number[])[0]).toBe(200);
    } finally {
      cleanup();
    }
  });

  it("handles empty updates array", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateItemAmounts({ updates: [] });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateCategoryEssential
// ---------------------------------------------------------------------------

describe("budget router — updateCategoryEssential", () => {
  it("sets all items in a category to non-essential", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateCategoryEssential({
        category: "Essentials",
        isEssential: false,
      });
      expect(result).toEqual({ ok: true });

      const summary = await caller.budget.computeActiveSummary();
      const essentials = summary.rawItems!.filter(
        (i) => i.category === "Essentials",
      );
      expect(essentials.length).toBeGreaterThan(0);
      for (const item of essentials) {
        expect(item.isEssential).toBe(false);
      }
    } finally {
      cleanup();
    }
  });

  it("sets all items in a category to essential", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // First set to false, then back to true
      await caller.budget.updateCategoryEssential({
        category: "Essentials",
        isEssential: false,
      });
      const result = await caller.budget.updateCategoryEssential({
        category: "Essentials",
        isEssential: true,
      });
      expect(result).toEqual({ ok: true });

      const summary = await caller.budget.computeActiveSummary();
      const essentials = summary.rawItems!.filter(
        (i) => i.category === "Essentials",
      );
      for (const item of essentials) {
        expect(item.isEssential).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("throws when no active profile exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.updateCategoryEssential({
          category: "Essentials",
          isEssential: false,
        }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });

  it("does nothing for a non-existent category (no items to update)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateCategoryEssential({
        category: "NonExistentCategory",
        isEssential: false,
      });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateColumnContributionProfileIds
// ---------------------------------------------------------------------------

describe("budget router — updateColumnContributionProfileIds", () => {
  it("sets column contribution profile IDs on the active profile", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const contribProfileId = seedContributionProfile(db);
      const result = await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [contribProfileId],
      });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });

  it("cleans up to null when all entries are null", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [null],
      });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });

  it("throws when length does not match column count", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await expect(
        caller.budget.updateColumnContributionProfileIds({
          columnContributionProfileIds: [null, null],
        }),
      ).rejects.toThrow(
        "columnContributionProfileIds length must match columnLabels length",
      );
    } finally {
      cleanup();
    }
  });

  it("throws when no active profile exists", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.updateColumnContributionProfileIds({
          columnContributionProfileIds: [null],
        }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });

  it("accepts null to clear contribution profile IDs", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const result = await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: null,
      });
      expect(result).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// linkContributionAccount / unlinkContributionAccount
// ---------------------------------------------------------------------------

describe("budget router — linkContributionAccount", () => {
  it("links a budget item to a contribution account", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId);
      const result = await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });
      expect(result).toEqual({ ok: true });

      // Verify via computeActiveSummary
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contributionAccountId).toBe(contrib.id);
    } finally {
      cleanup();
    }
  });
});

describe("budget router — unlinkContributionAccount", () => {
  it("removes contribution account link from a budget item", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId);

      // Link then unlink
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });
      const result = await caller.budget.unlinkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
      });
      expect(result).toEqual({ ok: true });

      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contributionAccountId).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// listContribAccountsForLinking
// ---------------------------------------------------------------------------

describe("budget router — listContribAccountsForLinking", () => {
  it("returns empty array when no contribution accounts exist", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listContribAccountsForLinking();
      expect(result).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("returns non-payroll accounts (jobId === null)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // Create a non-payroll contribution account (no jobId)
      await seedContribAccount(db, seed.personId);

      const result = await caller.budget.listContribAccountsForLinking();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]!.id).toBeDefined();
      expect(result[0]!.accountType).toBe("roth_ira");
      expect(typeof result[0]!.displayLabel).toBe("string");
    } finally {
      cleanup();
    }
  });

  it("excludes payroll-linked accounts (jobId !== null)", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // Create a payroll-linked contribution account
      await seedPayrollContribAccount(db, seed.personId, seed.jobId);

      const result = await caller.budget.listContribAccountsForLinking();
      // Should not include the payroll-linked one
      const payrollAcct = result.find((r) => r.accountType === "401k");
      expect(payrollAcct).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("includes display label from performance account when linked", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const perfAcctId = seedPerformanceAccount(db, {
        accountType: "roth_ira",
        institution: "Vanguard",
        accountLabel: "Vanguard Roth IRA",
        parentCategory: "Retirement",
      });
      await seedContribAccount(db, seed.personId, {
        performanceAccountId: perfAcctId,
      });

      const result = await caller.budget.listContribAccountsForLinking();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(typeof result[0]!.displayLabel).toBe("string");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// listApiCategories
// ---------------------------------------------------------------------------

describe("budget router — listApiCategories", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("returns empty groups when no budget API is active", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiCategories();
      expect(result).toEqual({ groups: [] });
    } finally {
      cleanup();
    }
  });

  it("returns empty groups when API is active but no cached data", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiCategories();
      expect(result).toEqual({ groups: [] });
    } finally {
      cleanup();
    }
  });

  it("returns categories from cache when available", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: "group-1",
          name: "Monthly Bills",
          hidden: false,
          categories: [
            {
              id: "cat-1",
              name: "Rent",
              hidden: false,
              budgeted: 2000,
              activity: -1800,
              balance: 200,
            },
          ],
        },
        {
          id: "group-2",
          name: "Internal Master Category",
          hidden: false,
          categories: [],
        },
      ],
    });

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiCategories();
      expect(result.groups.length).toBe(1); // Internal excluded
      expect(result.groups[0]!.name).toBe("Monthly Bills");
      expect(result.groups[0]!.categories[0]!.name).toBe("Rent");
    } finally {
      cleanup();
    }
  });

  it("filters hidden groups and categories", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: [
        {
          id: "g1",
          name: "Visible",
          hidden: false,
          categories: [
            {
              id: "c1",
              name: "Visible Cat",
              hidden: false,
              budgeted: 100,
              activity: -50,
              balance: 50,
            },
            {
              id: "c2",
              name: "Hidden Cat",
              hidden: true,
              budgeted: 0,
              activity: 0,
              balance: 0,
            },
          ],
        },
        {
          id: "g2",
          name: "Hidden Group",
          hidden: true,
          categories: [],
        },
      ],
    });

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiCategories();
      expect(result.groups.length).toBe(1);
      expect(result.groups[0]!.categories.length).toBe(1);
      expect(result.groups[0]!.categories[0]!.name).toBe("Visible Cat");
    } finally {
      cleanup();
    }
  });

  it("accepts explicit service parameter", async () => {
    const { cacheGet } = await import("@/lib/budget-api");
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiCategories({
        service: "actual",
      });
      expect(result).toEqual({ groups: [] });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// syncBudgetFromApi
// ---------------------------------------------------------------------------

describe("budget router — syncBudgetFromApi", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (mod.getClientForService as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("throws when no budget API is active", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await expect(
        caller.budget.syncBudgetFromApi({ selectedColumn: 0 }),
      ).rejects.toThrow("No budget API active");
    } finally {
      cleanup();
    }
  });

  it("throws when API is active but no cached month data", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await expect(
        caller.budget.syncBudgetFromApi({ selectedColumn: 0 }),
      ).rejects.toThrow("No cached month data");
    } finally {
      cleanup();
    }
  });

  it("pulls budgeted amounts from API cache into linked items", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        categories: [
          {
            id: "api-cat-1",
            budgeted: 1500,
            activity: -1200,
            balance: 300,
            goalTarget: 1500,
          },
        ],
      },
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);

      // Link an item to the API category with pull direction
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-cat-1",
        apiCategoryName: "Rent",
        syncDirection: "pull",
      });

      const result = await caller.budget.syncBudgetFromApi({
        selectedColumn: 0,
      });
      expect(result.updated).toBe(1);

      // Verify amount was updated
      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect((item!.amounts as number[])[0]).toBe(1500);
    } finally {
      cleanup();
    }
  });

  it("skips items with push-only sync direction", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        categories: [{ id: "api-cat-push", budgeted: 999, goalTarget: 999 }],
      },
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-cat-push",
        apiCategoryName: "Push Only",
        syncDirection: "push",
      });

      const result = await caller.budget.syncBudgetFromApi({
        selectedColumn: 0,
      });
      expect(result.updated).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("syncs items with both sync direction", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        categories: [{ id: "api-cat-both", budgeted: 750, goalTarget: 750 }],
      },
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-cat-both",
        apiCategoryName: "Both Dir",
        syncDirection: "both",
      });

      const result = await caller.budget.syncBudgetFromApi({
        selectedColumn: 0,
      });
      expect(result.updated).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("uses linked profile from apiConnections when configured", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { categories: [] },
    });

    const { caller, db, sqlite, cleanup } =
      await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // Create a second profile and link it via apiConnections
      const secondProfileId = await seedBudgetProfile(db, "API Profile", false);
      sqlite.exec(
        `INSERT INTO api_connections (service, config, linked_profile_id) VALUES ('ynab', '{}', ${secondProfileId})`,
      );

      const result = await caller.budget.syncBudgetFromApi({
        selectedColumn: 0,
      });
      expect(result.updated).toBe(0); // No linked items in the new profile
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// syncBudgetToApi
// ---------------------------------------------------------------------------

describe("budget router — syncBudgetToApi", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (mod.getClientForService as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("throws when no budget API is active", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await expect(
        caller.budget.syncBudgetToApi({ selectedColumn: 0 }),
      ).rejects.toThrow("No budget API active");
    } finally {
      cleanup();
    }
  });

  it("throws when API is active but client not available", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await expect(
        caller.budget.syncBudgetToApi({ selectedColumn: 0 }),
      ).rejects.toThrow("Budget API client not available");
    } finally {
      cleanup();
    }
  });

  it("pushes budget amounts to API for linked push items", async () => {
    const { getActiveBudgetApi, getClientForService, refreshCategoryCache } =
      await import("@/lib/budget-api");
    const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: mockUpdateGoal,
    });
    (refreshCategoryCache as ReturnType<typeof vi.fn>).mockClear();

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-push-cat",
        apiCategoryName: "Push Cat",
        syncDirection: "push",
      });

      const result = await caller.budget.syncBudgetToApi({
        selectedColumn: 0,
      });
      expect(result.pushed).toBe(1);
      expect(mockUpdateGoal).toHaveBeenCalledWith("api-push-cat", 2000);
      // Push must refresh budget_api_cache so subsequent previews don't
      // show stale pre-push diffs (see refreshCategoryCache doc comment).
      expect(refreshCategoryCache).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("does not refresh the cache when nothing was pushed", async () => {
    const { getActiveBudgetApi, getClientForService, refreshCategoryCache } =
      await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: vi.fn(),
    });
    (refreshCategoryCache as ReturnType<typeof vi.fn>).mockClear();

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // No items linked with push/both direction — nothing to push.
      const result = await caller.budget.syncBudgetToApi({
        selectedColumn: 0,
      });
      expect(result.pushed).toBe(0);
      expect(refreshCategoryCache).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("skips items with pull-only sync direction", async () => {
    const { getActiveBudgetApi, getClientForService } =
      await import("@/lib/budget-api");
    const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: mockUpdateGoal,
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-pull-cat",
        apiCategoryName: "Pull Cat",
        syncDirection: "pull",
      });

      const result = await caller.budget.syncBudgetToApi({
        selectedColumn: 0,
      });
      expect(result.pushed).toBe(0);
      expect(mockUpdateGoal).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("pushes items with both sync direction", async () => {
    const { getActiveBudgetApi, getClientForService } =
      await import("@/lib/budget-api");
    const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: mockUpdateGoal,
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "api-both-cat",
        apiCategoryName: "Both Cat",
        syncDirection: "both",
      });

      const result = await caller.budget.syncBudgetToApi({
        selectedColumn: 0,
      });
      expect(result.pushed).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("uses linked profile from apiConnections when configured", async () => {
    const { getActiveBudgetApi, getClientForService } =
      await import("@/lib/budget-api");
    const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: mockUpdateGoal,
    });

    const { caller, db, sqlite, cleanup } =
      await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const secondProfileId = await seedBudgetProfile(
        db,
        "Push Profile",
        false,
      );
      sqlite.exec(
        `INSERT INTO api_connections (service, config, linked_profile_id) VALUES ('ynab', '{}', ${secondProfileId})`,
      );

      const result = await caller.budget.syncBudgetToApi({
        selectedColumn: 0,
      });
      expect(result.pushed).toBe(0); // No linked items in new profile
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// listApiActuals
// ---------------------------------------------------------------------------

describe("budget router — listApiActuals", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (mod.getClientForService as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("returns empty actuals when no API is active", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiActuals();
      expect(result.actuals).toEqual([]);
      expect(result.service).toBeNull();
      expect(result.month).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns empty actuals when API is active but no cached month", async () => {
    const { getActiveBudgetApi } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      const result = await caller.budget.listApiActuals();
      expect(result.actuals).toEqual([]);
      expect(result.service).toBe("ynab");
      expect(result.month).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns empty actuals when API+cache exist but no active profile", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { categories: [] },
    });

    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      // No profiles seeded
      const result = await caller.budget.listApiActuals();
      expect(result.actuals).toEqual([]);
      expect(result.service).toBe("ynab");
    } finally {
      cleanup();
    }
  });

  it("returns actuals for linked items with cached month data", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        categories: [
          {
            id: "actual-cat-1",
            budgeted: 2000,
            activity: -1800,
            balance: 200,
          },
        ],
      },
    });

    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await caller.budget.linkToApi({
        budgetItemId: seed.itemIds[0]!,
        apiCategoryId: "actual-cat-1",
        apiCategoryName: "Rent",
        syncDirection: "pull",
      });

      const result = await caller.budget.listApiActuals();
      expect(result.actuals.length).toBe(1);
      expect(result.actuals[0]!.budgetItemId).toBe(seed.itemIds[0]!);
      expect(result.actuals[0]!.budgeted).toBe(2000);
      expect(result.actuals[0]!.activity).toBe(-1800);
      expect(result.actuals[0]!.balance).toBe(200);
      expect(result.month).toBeDefined();
      expect(result.service).toBe("ynab");
    } finally {
      cleanup();
    }
  });

  it("returns linked profile info from apiConnections", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { categories: [] },
    });

    const { caller, db, sqlite, cleanup } =
      await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      sqlite.exec(
        `INSERT INTO api_connections (service, config, linked_profile_id, linked_column_index) VALUES ('ynab', '{}', ${seed.profileId}, 2)`,
      );

      const result = await caller.budget.listApiActuals();
      expect(result.linkedProfileId).toBe(seed.profileId);
      expect(result.linkedColumnIndex).toBe(2);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// addColumn / removeColumn with columnMonths + contribProfileIds
// ---------------------------------------------------------------------------

describe("budget router — addColumn with columnMonths set", () => {
  it("extends columnMonths when adding a column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // Set columnMonths first
      await caller.budget.updateColumnMonths({ columnMonths: [12] });

      // Add column — should extend months with 0
      await caller.budget.addColumn({ label: "Extra" });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.isActive);
      expect(main!.columnMonths).toEqual([12, 0]);
    } finally {
      cleanup();
    }
  });

  it("extends columnContributionProfileIds when adding a column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const contribProfileId = seedContributionProfile(db);
      await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [contribProfileId],
      });

      await caller.budget.addColumn({ label: "Extra" });

      // We can't directly read contribProfileIds from listProfiles,
      // but the operation should not throw
    } finally {
      cleanup();
    }
  });
});

describe("budget router — removeColumn with columnMonths set", () => {
  it("shrinks columnMonths when removing a column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // Add a column to get 2 columns
      await caller.budget.addColumn({ label: "To Remove" });
      // Set column months
      await caller.budget.updateColumnMonths({ columnMonths: [8, 4] });

      // Remove column 1
      await caller.budget.removeColumn({ colIndex: 1 });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.isActive);
      expect(main!.columnMonths).toEqual([8]);
    } finally {
      cleanup();
    }
  });

  it("shrinks columnContributionProfileIds when removing a column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await caller.budget.addColumn({ label: "To Remove" });
      const contribProfileId = seedContributionProfile(db);
      await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [contribProfileId, null],
      });

      // Should not throw
      await caller.budget.removeColumn({ colIndex: 1 });
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// listProfiles — weighted annual total
// ---------------------------------------------------------------------------

describe("budget router — listProfiles weighted annual total", () => {
  it("computes weighted annualTotal when columnMonths are set", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      // Add column and set amounts for col1
      await caller.budget.addColumn({ label: "High" });

      // Get items to find IDs
      const summary = await caller.budget.computeActiveSummary();
      // Set col1 amounts
      for (const item of summary.rawItems!) {
        await caller.budget.updateItemAmount({
          id: item.id,
          colIndex: 1,
          amount: 100,
        });
      }

      // Set months: col0=9, col1=3
      await caller.budget.updateColumnMonths({ columnMonths: [9, 3] });

      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.isActive)!;
      // col0 total = 2000 + 600 + 200 = 2800, weighted * 9 = 25200
      // col1 total = items * 100 each, weighted * 3
      expect(main.annualTotal).toBeGreaterThan(0);
      expect(typeof main.annualTotal).toBe("number");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// computeActiveSummary — contribution-linked items
// ---------------------------------------------------------------------------

describe("budget router — computeActiveSummary with contribution-linked items", () => {
  it("replaces amounts with contribution monthly for linked items", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // Create a non-payroll contribution account with dollar amount
      const contrib = await seedContribAccount(db, seed.personId, {
        contributionMethod: "dollar_amount",
        contributionValue: "600",
        jobId: null,
      });

      // Link it to a budget item
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contributionAccountId).toBe(contrib.id);
      // contribAmount should be set (the computed monthly from the contribution)
      expect(item!.contribAmount).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns columnMonths in the summary", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await caller.budget.updateColumnMonths({ columnMonths: [12] });

      const summary = await caller.budget.computeActiveSummary();
      expect(summary.columnMonths).toEqual([12]);
    } finally {
      cleanup();
    }
  });

  it("returns weightedAnnualTotal reflecting column months", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      await caller.budget.updateColumnMonths({ columnMonths: [6] });

      const summary = await caller.budget.computeActiveSummary();
      expect(typeof summary.weightedAnnualTotal).toBe("number");
      // 2800/month * 6 months = 16800 (only one column with 6 months)
      expect(summary.weightedAnnualTotal).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("handles job-linked contribution with percent_of_salary method", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // Create a payroll-linked contribution
      const contrib = await seedPayrollContribAccount(
        db,
        seed.personId,
        seed.jobId,
        {
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
        },
      );

      // Link to budget item
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const summary = await caller.budget.computeActiveSummary();
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contributionAccountId).toBe(contrib.id);
      // The contribution should compute a non-null amount based on salary
      expect(item!.contribAmount).not.toBeNull();
      expect(typeof item!.contribAmount).toBe("number");
    } finally {
      cleanup();
    }
  });

  it("honors activeContribProfileId as a fallback when the column has no explicit override — must match what use-budget-derived-data.ts's payroll breakdown resolves for the same column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId, {
        contributionMethod: "dollar_amount",
        contributionValue: "600",
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const profileId = seedContributionProfile(db, {
        name: "Alt Contribution Profile",
        isDefault: false,
        contributionOverrides: {
          contributionAccounts: {
            [String(contrib.id)]: { contributionValue: "900" },
          },
        },
      });

      // No activeContribProfileId → Live (the account's own $600).
      const liveSummary = await caller.budget.computeActiveSummary();
      const liveItem = liveSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      // contribAmount is monthly; contributionValue "600" is annual → 50/mo.
      expect(liveItem!.contribAmount).toBe(50);

      // No per-column override exists, but activeContribProfileId is
      // passed — the column must fall through to it (this is the fix:
      // previously the server ignored this param entirely).
      const overriddenSummary = await caller.budget.computeActiveSummary({
        activeContribProfileId: profileId,
      });
      const overriddenItem = overriddenSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      expect(overriddenItem!.contribAmount).toBe(75);
    } finally {
      cleanup();
    }
  });

  it("prefers a per-column override over activeContribProfileId when both are set", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId, {
        contributionMethod: "dollar_amount",
        contributionValue: "600",
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const columnProfileId = seedContributionProfile(db, {
        name: "Column Profile",
        isDefault: false,
        contributionOverrides: {
          contributionAccounts: {
            [String(contrib.id)]: { contributionValue: "750" },
          },
        },
      });
      const globalProfileId = seedContributionProfile(db, {
        name: "Global Profile",
        isDefault: false,
        contributionOverrides: {
          contributionAccounts: {
            [String(contrib.id)]: { contributionValue: "900" },
          },
        },
      });
      await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [columnProfileId],
      });

      const summary = await caller.budget.computeActiveSummary({
        activeContribProfileId: globalProfileId,
      });
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contribAmount).toBe(62.5);
    } finally {
      cleanup();
    }
  });

  it("honors a Plan-level salaryOverride for percent-of-salary contribution-linked items — must agree with what paycheck.computeSummary resolves for the same person/override", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      // 10% of salary, linked to a payroll job (seedStandardDataset's job
      // defaults to $120,000/yr).
      // computeAnnualContribution divides percent_of_salary values by 100,
      // so "10" here means 10%.
      const contrib = await seedPayrollContribAccount(
        db,
        seed.personId,
        seed.jobId,
        { contributionMethod: "percent_of_salary", contributionValue: "10" },
      );
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const salaryOverrides = [{ personId: seed.personId, salary: 240000 }];

      // Before the fix, computeActiveSummary had no salaryOverrides input
      // at all and this would silently stay at the $120,000 live figure.
      const liveSummary = await caller.budget.computeActiveSummary();
      const liveItem = liveSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      expect(liveItem!.contribAmount).toBeCloseTo((120000 * 0.1) / 12, 2);

      const [paycheckResult, overriddenSummary] = await Promise.all([
        caller.paycheck.computeSummary({ salaryOverrides }),
        caller.budget.computeActiveSummary({ salaryOverrides }),
      ]);

      const paycheckPerson = paycheckResult.people.find(
        (p) => p.person.id === seed.personId,
      );
      expect(paycheckPerson!.salary).toBe(240000);

      const overriddenItem = overriddenSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      // Budget must now agree with Paycheck's resolved salary — both are
      // driven by the same 240,000 override, not the raw 120,000.
      expect(overriddenItem!.contribAmount).toBeCloseTo(
        (paycheckPerson!.salary * 0.1) / 12,
        2,
      );
      expect(overriddenItem!.contribAmount).toBeCloseTo((240000 * 0.1) / 12, 2);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// createItem — sort order within category
// ---------------------------------------------------------------------------

describe("budget router — createItem sort order", () => {
  it("places new item at end of existing category", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const item1 = await caller.budget.createItem({
        category: "Essentials",
        subcategory: "Water",
      });
      const item2 = await caller.budget.createItem({
        category: "Essentials",
        subcategory: "Electric",
      });
      expect(item2!.sortOrder).toBeGreaterThan(item1!.sortOrder);
    } finally {
      cleanup();
    }
  });

  it("places new item in a brand new category after all existing items", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const item = await caller.budget.createItem({
        category: "BrandNewCategory",
        subcategory: "First Item",
      });
      expect(item!.sortOrder).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// addColumn / removeColumn — no active profile
// ---------------------------------------------------------------------------

describe("budget router — column operations without active profile", () => {
  it("addColumn throws when no active profile", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.addColumn({ label: "New Col" }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });

  it("removeColumn throws when no active profile", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(caller.budget.removeColumn({ colIndex: 0 })).rejects.toThrow(
        "No active profile",
      );
    } finally {
      cleanup();
    }
  });

  it("renameColumn throws when no active profile", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.renameColumn({ colIndex: 0, label: "X" }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });

  it("updateColumnMonths throws when no active profile", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.updateColumnMonths({ columnMonths: [12] }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });

  it("createItem throws when no active profile", async () => {
    const { caller, cleanup } = await createTestCaller(adminSession);
    try {
      await expect(
        caller.budget.createItem({
          category: "Test",
          subcategory: "Item",
        }),
      ).rejects.toThrow("No active profile");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// syncBudgetFromApi — no linked or active profile via apiConnections
// ---------------------------------------------------------------------------

describe("budget router — syncBudgetFromApi no profile", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (mod.getClientForService as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("throws NOT_FOUND when no linked or active budget profile", async () => {
    const { getActiveBudgetApi, cacheGet } = await import("@/lib/budget-api");
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (cacheGet as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { categories: [] },
    });

    const { caller, sqlite, cleanup } = await createTestCaller(adminSession);
    try {
      // Insert apiConnections pointing to a non-existent profile
      sqlite.exec(
        `INSERT INTO api_connections (service, config, linked_profile_id) VALUES ('ynab', '{}', 999999)`,
      );

      await expect(
        caller.budget.syncBudgetFromApi({ selectedColumn: 0 }),
      ).rejects.toThrow("No linked or active budget profile");
    } finally {
      cleanup();
    }
  });
});

describe("budget router — syncBudgetToApi no profile", () => {
  beforeEach(async () => {
    const mod = await import("@/lib/budget-api");
    (mod.getActiveBudgetApi as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue("none");
    (mod.cacheGet as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
    (mod.getClientForService as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue(null);
  });

  it("throws NOT_FOUND when no linked or active budget profile", async () => {
    const { getActiveBudgetApi, getClientForService } =
      await import("@/lib/budget-api");
    const mockUpdateGoal = vi.fn().mockResolvedValue(undefined);
    (getActiveBudgetApi as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      "ynab",
    );
    (getClientForService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      updateCategoryGoalTarget: mockUpdateGoal,
    });

    const { caller, sqlite, cleanup } = await createTestCaller(adminSession);
    try {
      sqlite.exec(
        `INSERT INTO api_connections (service, config, linked_profile_id) VALUES ('ynab', '{}', 999999)`,
      );

      await expect(
        caller.budget.syncBudgetToApi({ selectedColumn: 0 }),
      ).rejects.toThrow("No linked or active budget profile");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: mutations must honor an explicit profileId instead of always
// targeting the globally-active profile. A client viewing (not activating) a
// non-active profile passes its id explicitly — before this fix, createItem/
// addColumn/removeColumn/renameColumn/updateColumnMonths/
// updateColumnContributionProfileIds/updateCategoryEssential all silently
// redirected the edit onto the active profile instead.
// ---------------------------------------------------------------------------

describe("budget router — item/column mutations target explicit profileId", () => {
  it("createItem creates the item under the given non-active profile, not the active one", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const activeProfileId = (await caller.budget.listProfiles()).find(
        (p) => p.isActive,
      )!.id;
      const viewedProfileId = await seedBudgetProfile(db, "Viewed", false);

      const created = await caller.budget.createItem({
        category: "New Category",
        subcategory: "New Sub",
        profileId: viewedProfileId,
      });

      expect(created!.profileId).toBe(viewedProfileId);
      expect(created!.profileId).not.toBe(activeProfileId);
    } finally {
      cleanup();
    }
  });

  it("addColumn/renameColumn/removeColumn/updateColumnMonths target the given non-active profile", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const viewedProfileId = await seedBudgetProfile(db, "Viewed", false);

      await caller.budget.addColumn({
        label: "Extra",
        profileId: viewedProfileId,
      });
      await caller.budget.renameColumn({
        colIndex: 1,
        label: "Renamed",
        profileId: viewedProfileId,
      });
      await caller.budget.updateColumnMonths({
        columnMonths: [10, 2],
        profileId: viewedProfileId,
      });

      const profiles = await caller.budget.listProfiles();
      const viewed = profiles.find((p) => p.id === viewedProfileId)!;
      const active = profiles.find((p) => p.isActive)!;
      expect(viewed.columnLabels).toEqual(["Standard", "Renamed"]);
      expect(viewed.columnMonths).toEqual([10, 2]);
      // The active profile must be untouched by edits scoped to viewedProfileId.
      expect(active.columnLabels).toEqual(["Standard"]);
      expect(active.columnMonths).toBeNull();

      await caller.budget.removeColumn({
        colIndex: 1,
        profileId: viewedProfileId,
      });
      const afterRemove = (await caller.budget.listProfiles()).find(
        (p) => p.id === viewedProfileId,
      )!;
      expect(afterRemove.columnLabels).toEqual(["Standard"]);
    } finally {
      cleanup();
    }
  });

  it("updateCategoryEssential only touches items in the given non-active profile", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const viewedProfileId = await seedBudgetProfile(db, "Viewed", false);
      await caller.budget.createItem({
        category: "Shared Category",
        subcategory: "Item",
        isEssential: false,
        profileId: viewedProfileId,
      });

      await caller.budget.updateCategoryEssential({
        category: "Shared Category",
        isEssential: true,
        profileId: viewedProfileId,
      });

      const schema = await getSchema();
      const items = await db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, viewedProfileId));
      expect(items.every((i) => i.isEssential)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
