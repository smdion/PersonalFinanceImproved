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
  seedPerson,
  viewerSession,
} from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

vi.mock("@/lib/budget-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/budget-api")>();
  return {
    ...actual,
    getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
    cacheGet: vi.fn().mockResolvedValue(null),
    getClientForService: vi.fn().mockResolvedValue(null),
    refreshCategoryCache: vi.fn().mockResolvedValue(undefined),
    YNAB_INTERNAL_GROUPS: new Set([
      "Internal Master Category",
      "Credit Card Payments",
    ]),
  };
});

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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);
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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("reports skipped cells (deleted item / out-of-range column) and counts applied cells", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const result = await caller.budget.updateItemAmounts({
        updates: [
          { id: seed.itemIds[0]!, colIndex: 0, amount: 500 }, // applies
          { id: seed.itemIds[1]!, colIndex: 0, amount: 600 }, // applies
          { id: seed.itemIds[0]!, colIndex: 99, amount: 700 }, // out of range
          { id: 999999, colIndex: 0, amount: 800 }, // deleted / never existed
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.updated).toBe(2); // applied cells
      expect(result.updatedItems).toBe(2); // distinct items touched
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          { id: seed.itemIds[0]!, colIndex: 99, reason: "column-out-of-range" },
          { id: 999999, colIndex: 0, reason: "deleted" },
        ]),
      );
      expect(result.skipped).toHaveLength(2);

      const summary = await caller.budget.computeActiveSummary();
      const item0 = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect((item0!.amounts as number[])[0]).toBe(500); // valid cell landed
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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);
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
      expect(result.ok).toBe(true);
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
      expect(result.ok).toBe(true);
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
      expect(result.ok).toBe(true);
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
      expect(result.ok).toBe(true);

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
      expect(result.ok).toBe(true);

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

  /**
   * Regression test for a real, reported bug: two people's individual
   * contribution accounts under one jointly-tracked performance account
   * (e.g. one Vanguard IRA both spouses contribute to separately) both
   * rendered as the identical generic "Joint IRA (Vanguard)" — the shared
   * master's own ownershipType ("joint") was winning over each row's own
   * real owner (ownership: "individual" + personId). This made it
   * impossible to tell, in the "unlinked contribution accounts" list,
   * which account belonged to which person.
   */
  it("distinguishes each person's own account under one jointly-tracked performance account", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const otherPersonId = await seedPerson(db, "Joanna");
      const jointPerfAcctId = seedPerformanceAccount(db, {
        accountType: "ira",
        institution: "Vanguard",
        accountLabel: "IRA (Vanguard)",
        ownershipType: "joint",
        parentCategory: "Retirement",
      });
      await seedContribAccount(db, seed.personId, {
        performanceAccountId: jointPerfAcctId,
        ownership: "individual",
        accountType: "ira",
        taxTreatment: "tax_free",
      });
      await seedContribAccount(db, otherPersonId, {
        performanceAccountId: jointPerfAcctId,
        ownership: "individual",
        accountType: "ira",
        taxTreatment: "tax_free",
      });

      const result = await caller.budget.listContribAccountsForLinking();
      const labels = result.map((r) => r.displayLabel).sort();
      expect(labels).toEqual([
        "Joanna IRA (Vanguard) — Roth",
        "Test Person IRA (Vanguard) — Roth",
      ]);
    } finally {
      cleanup();
    }
  });

  /**
   * Regression test for a real, reported case: one person's OWN Roth and
   * Traditional IRA at the same institution, linked to the same
   * jointly-tracked performance account, otherwise share every label
   * component (owner, institution, account type) — only tax treatment
   * differs. Without it, a linked Roth IRA and an unlinked Traditional IRA
   * for the same person both showed as the identical "Sean IRA (Vanguard)",
   * making it look like the unlinked one was a duplicate of the linked one.
   */
  it("distinguishes one person's own Roth vs Traditional account under the same performance account", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const jointPerfAcctId = seedPerformanceAccount(db, {
        accountType: "ira",
        institution: "Vanguard",
        accountLabel: "IRA (Vanguard)",
        ownershipType: "joint",
        parentCategory: "Retirement",
      });
      await seedContribAccount(db, seed.personId, {
        performanceAccountId: jointPerfAcctId,
        ownership: "individual",
        accountType: "ira",
        taxTreatment: "tax_free",
      });
      await seedContribAccount(db, seed.personId, {
        performanceAccountId: jointPerfAcctId,
        ownership: "individual",
        accountType: "ira",
        taxTreatment: "pre_tax",
      });

      const result = await caller.budget.listContribAccountsForLinking();
      const labels = result.map((r) => r.displayLabel).sort();
      expect(labels).toEqual([
        "Test Person IRA (Vanguard) — Roth",
        "Test Person IRA (Vanguard) — Traditional",
      ]);
    } finally {
      cleanup();
    }
  });

  /**
   * Regression test: a joint contribution account with no linked
   * performance account yet (the normal pre-linking state) used to lose
   * its "Joint" prefix entirely once the ownership-precedence fix landed.
   * The old code fell back to `perf?.ownershipType ?? c.ownership`, so
   * with no perf it used the account's own ownership ("joint"). The new
   * portfolioAccountLabel-based call only ever fell back to
   * `perf?.ownershipType`, never the caller's own row, so a null perf
   * silently dropped the owner prefix — making a joint account
   * indistinguishable from an individual one in the linking dropdown.
   */
  it("keeps the 'Joint' label for a joint contribution account with no linked performance account", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      await seedContribAccount(db, seed.personId, {
        ownership: "joint",
        personId: null,
        accountType: "ira",
        performanceAccountId: null,
      });

      const result = await caller.budget.listContribAccountsForLinking();
      expect(result).toHaveLength(1);
      expect(result[0]!.displayLabel).toMatch(/^Joint /);
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
        service: "ynab",
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
      // A single-column profile's weighting must still cover the full year
      // (columnMonths sums to 12) — see updateColumnMonths' validation.
      await caller.budget.updateColumnMonths({ columnMonths: [12] });

      const summary = await caller.budget.computeActiveSummary();
      expect(typeof summary.weightedAnnualTotal).toBe("number");
      // 2800/month * 12 months = 33600 (only one column, spans the full year)
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

  it("honors the globally-active Contribution Profile when the column has no explicit override — must match what use-budget-derived-data.ts's payroll breakdown resolves for the same column", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId, {
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const profileId = seedContributionProfile(db, {
        name: "Alt Contribution Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "900",
              contributionMethod: "fixed_annual",
            },
          },
        },
      });

      // No Contribution Profile tiers at all — accounts carry no value of
      // their own anymore, so a linked item with no resolvable profile
      // contributes nothing.
      const liveSummary = await caller.budget.computeActiveSummary();
      const liveItem = liveSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      expect(liveItem!.contribAmount).toBe(0);

      // No per-column override exists, but a globally-active Contribution
      // Profile is passed — the column must fall through to it (this is the
      // fix: previously the server ignored this param entirely).
      const overriddenSummary = await caller.budget.computeActiveSummary({
        contributionProfile: {
          planPinId: null,
          localSelectionId: null,
          globalDefaultId: profileId,
        },
      });
      const overriddenItem = overriddenSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      expect(overriddenItem!.contribAmount).toBe(75);
    } finally {
      cleanup();
    }
  });

  it("prefers a per-column override over the globally-active Contribution Profile when both are set", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId, {
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });

      const columnProfileId = seedContributionProfile(db, {
        name: "Column Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "750",
              contributionMethod: "fixed_annual",
            },
          },
        },
      });
      const globalProfileId = seedContributionProfile(db, {
        name: "Global Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "900",
              contributionMethod: "fixed_annual",
            },
          },
        },
      });
      await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [columnProfileId],
      });

      const summary = await caller.budget.computeActiveSummary({
        contributionProfile: {
          planPinId: null,
          localSelectionId: null,
          globalDefaultId: globalProfileId,
        },
      });
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(item!.contribAmount).toBe(62.5);
    } finally {
      cleanup();
    }
  });

  it("honors a Plan-level active salary for percent-of-salary contribution-linked items — must agree with what paycheck.computeSummary resolves for the same person/override", async () => {
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
      );
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });
      // Accounts carry no value of their own — a Contribution Profile with
      // the 10% active field is what both calls below resolve through; the
      // salary axis (Plan-level active salary) is the only thing that
      // changes between them.
      const profileId = seedContributionProfile(db, {
        name: "TenPercent",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "10",
              contributionMethod: "percent_of_salary",
            },
          },
        },
      });
      const contributionProfile = {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: profileId,
      };
      // budget.computeActiveSummary resolves the Salary axis the same
      // explicit way as Contribution — no salaryProfile input means "no
      // preference," not "fall back to whatever's active" (see NO_PROFILE_TIERS
      // in budget.ts). seedJob registered this job's $120,000 into the
      // globally-active profile (setup.ts's seedDefaultSalaryProfileEntry),
      // so pass that id explicitly, matching what the real client does.
      const activeSalaryProfileId = Number(
        db
          .select()
          .from(sqliteSchema.appSettings)
          .where(eq(sqliteSchema.appSettings.key, SK_ACTIVE_SALARY_PROFILE_ID))
          .get()?.value,
      );
      const salaryProfile = {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: activeSalaryProfileId,
      };

      const liveSummary = await caller.budget.computeActiveSummary({
        contributionProfile,
        salaryProfile,
      });
      const liveItem = liveSummary.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      expect(liveItem!.contribAmount).toBeCloseTo((120000 * 0.1) / 12, 2);

      const salaryActiveFields = [{ personId: seed.personId, salary: 240000 }];
      const [paycheckResult, overriddenSummary] = await Promise.all([
        caller.paycheck.computeSummary({ salaryActiveFields }),
        caller.budget.computeActiveSummary({
          salaryActiveFields,
          contributionProfile,
          salaryProfile,
        }),
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
// What-If sandbox support: itemAmountActiveFields + netMonthlyIncome.
// ---------------------------------------------------------------------------
describe("budget router — computeActiveSummary sandbox support", () => {
  it("itemAmountActiveFields replaces an item's amount for the given column, leaving others untouched", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);

      const summary = await caller.budget.computeActiveSummary({
        itemAmountActiveFields: [
          { itemId: seed.itemIds[0]!, colIndex: 0, amount: 9999 },
        ],
      });

      const overridden = summary
        .allColumnResults![0]!.categories.flatMap((c) => c.items)
        .find((i) => i.label === "Rent");
      const untouched = summary
        .allColumnResults![0]!.categories.flatMap((c) => c.items)
        .find((i) => i.label === "Groceries");

      expect(overridden!.amount).toBeCloseTo(9999, 2);
      expect(untouched!.amount).toBeCloseTo(600, 2);

      // rawItems (used for the client's OWN draft display) keeps the raw
      // DB amount — the override is a server-computed-totals concern, not
      // a persisted change.
      const rawItem = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      expect(rawItem!.amounts[0]).toBeCloseTo(2000, 2);
    } finally {
      cleanup();
    }
  });

  it("itemAmountActiveFields layers on top of a contribution-linked item's resolved amount, not a raw one", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contrib = await seedContribAccount(db, seed.personId, {
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });
      const profileId = seedContributionProfile(db, {
        name: "SixHundred",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "600",
              contributionMethod: "fixed_annual",
            },
          },
        },
      });
      const contributionProfile = {
        planPinId: null,
        localSelectionId: null,
        globalDefaultId: profileId,
      };

      const withoutOverride = await caller.budget.computeActiveSummary({
        contributionProfile,
      });
      const linkedItem = withoutOverride.rawItems!.find(
        (i) => i.id === seed.itemIds[0]!,
      );
      // fixed_annual is treated as an annual figure by
      // computeContribMonthlyForPair — $600/yr resolves to $50/mo.
      expect(linkedItem!.contribAmount).toBeCloseTo(50, 2);

      const withOverride = await caller.budget.computeActiveSummary({
        contributionProfile,
        itemAmountActiveFields: [
          { itemId: seed.itemIds[0]!, colIndex: 0, amount: 750 },
        ],
      });
      const overriddenTotal = withOverride
        .allColumnResults![0]!.categories.flatMap((c) => c.items)
        .find((i) => i.label === "Rent");
      expect(overriddenTotal!.amount).toBeCloseTo(750, 2);
    } finally {
      cleanup();
    }
  });

  it("returns netMonthlyIncome computed from the selected column's resolved profile pair", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const summary = await caller.budget.computeActiveSummary();
      expect(typeof summary.netMonthlyIncome).toBe("number");
      expect(summary.netMonthlyIncome).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("sandboxSalaryEntries changes netMonthlyIncome", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const baseline = await caller.budget.computeActiveSummary();

      const withSandbox = await caller.budget.computeActiveSummary({
        sandboxSalaryEntries: {
          [String(seed.personId)]: { salary: 500000 },
        },
      });

      expect(withSandbox.netMonthlyIncome).not.toBeCloseTo(
        baseline.netMonthlyIncome!,
        2,
      );
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (pre-existing bug): computeActiveSummary resolved ONE
// contribution/salary profile from `selectedColumn` and wrote that single
// monthly figure into every column's amounts, then derived allColumnResults
// from that flattened data. So on a profile whose columns pin DIFFERENT
// Contribution Profiles:
//   - every column's linked-item $ showed the selected column's profile, and
//   - the totals changed depending on which column you happened to be
//     viewing, while the client's own per-column payroll breakdown
//     (use-budget-derived-data.ts → usePerColumnPaycheck) resolved each
//     column independently and disagreed.
// ---------------------------------------------------------------------------
describe("budget router — computeActiveSummary resolves a profile PER COLUMN", () => {
  /** Two columns pinning contribution profiles worth $100/mo and $200/mo. */
  async function seedTwoColumnsWithDifferentPins() {
    const ctx = await createTestCaller(adminSession);
    const { caller, db } = ctx;
    const seed = seedStandardDataset(db);
    const contrib = await seedContribAccount(db, seed.personId, {
      contributionMethod: "dollar_amount",
      contributionValue: "600", // $50/mo with no profile applied
      jobId: null,
    });
    await caller.budget.linkContributionAccount({
      budgetItemId: seed.itemIds[0]!,
      contributionAccountId: contrib.id,
    });

    const profileA = seedContributionProfile(db, {
      name: "Column A Profile",
      contributionActiveFields: {
        contributionAccounts: {
          [String(contrib.id)]: {
            contributionValue: "1200", // $100/mo
            contributionMethod: "fixed_annual",
          },
        },
      },
    });
    const profileB = seedContributionProfile(db, {
      name: "Column B Profile",
      contributionActiveFields: {
        contributionAccounts: {
          [String(contrib.id)]: {
            contributionValue: "2400", // $200/mo
            contributionMethod: "fixed_annual",
          },
        },
      },
    });

    await caller.budget.addColumn({ label: "Travel" });
    await caller.budget.updateColumnContributionProfileIds({
      columnContributionProfileIds: [profileA, profileB],
    });

    return { ...ctx, seed, contrib, profileA, profileB };
  }

  it("gives each column its own linked-item amount instead of broadcasting one", async () => {
    const { caller, seed, cleanup } = await seedTwoColumnsWithDifferentPins();
    try {
      const summary = await caller.budget.computeActiveSummary({
        selectedColumn: 0,
      });
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      // OLD behavior: [100, 100] — column 1 silently used column 0's profile.
      expect(item!.contribAmounts).toEqual([100, 200]);
      expect(summary.contribProfileIdByColumn).toHaveLength(2);
      expect(summary.contribProfileIdByColumn![0]).not.toBe(
        summary.contribProfileIdByColumn![1],
      );
    } finally {
      cleanup();
    }
  });

  it("allColumnResults no longer change with the column you happen to be viewing", async () => {
    const { caller, cleanup } = await seedTwoColumnsWithDifferentPins();
    try {
      const fromColumn0 = await caller.budget.computeActiveSummary({
        selectedColumn: 0,
      });
      const fromColumn1 = await caller.budget.computeActiveSummary({
        selectedColumn: 1,
      });
      // OLD behavior: viewing column 0 made BOTH columns report the $100
      // profile and viewing column 1 made both report $200, so these two
      // arrays disagreed.
      expect(fromColumn1.allColumnResults).toEqual(
        fromColumn0.allColumnResults,
      );

      const col0 = fromColumn0.allColumnResults![0]!;
      const col1 = fromColumn0.allColumnResults![1]!;
      // seedStandardDataset's unlinked items (600 + 200) only exist in
      // column 0; addColumn appends 0 for them. So each column's total is
      // its own linked-item amount plus its own unlinked items:
      //   col0 = 100 (profile A) + 600 + 200 = 900
      //   col1 = 200 (profile B) + 0   + 0   = 200
      // The $100 gap between the two pinned Contribution Profiles is what
      // makes the linked portions differ at all.
      expect(col0.totalMonthly).toBeCloseTo(900, 6);
      expect(col1.totalMonthly).toBeCloseTo(200, 6);
    } finally {
      cleanup();
    }
  });

  it("each column's amount matches what that column's OWN profile computes on its own", async () => {
    const { caller, seed, profileA, profileB, cleanup } =
      await seedTwoColumnsWithDifferentPins();
    try {
      const perColumn = await caller.budget.computeActiveSummary({
        selectedColumn: 0,
      });
      const item = perColumn.rawItems!.find((i) => i.id === seed.itemIds[0]!);

      // The reference values: what a single-column profile pinned to A (or
      // B) resolves — i.e. what the client's own per-column paycheck query
      // for that pin would produce.
      for (const [colIdx, profileId] of [
        [0, profileA],
        [1, profileB],
      ] as const) {
        const reference = await caller.budget.computeActiveSummary({
          selectedColumn: colIdx,
          contributionProfile: {
            planPinId: profileId,
            localSelectionId: null,
            globalDefaultId: null,
          },
        });
        const refItem = reference.rawItems!.find(
          (i) => i.id === seed.itemIds[0]!,
        );
        expect(item!.contribAmounts![colIdx]).toBeCloseTo(
          refItem!.contribAmounts![colIdx]!,
          6,
        );
      }
    } finally {
      cleanup();
    }
  });

  it("a Plan pin overrides every column's own pin (documented precedence)", async () => {
    const { caller, db, seed, contrib, cleanup } =
      await seedTwoColumnsWithDifferentPins();
    try {
      const planProfileId = seedContributionProfile(db, {
        name: "Plan-Pinned Profile",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "3600", // $300/mo
              contributionMethod: "fixed_annual",
            },
          },
        },
      });
      const summary = await caller.budget.computeActiveSummary({
        selectedColumn: 0,
        contributionProfile: {
          planPinId: planProfileId,
          localSelectionId: null,
          globalDefaultId: null,
        },
      });
      const item = summary.rawItems!.find((i) => i.id === seed.itemIds[0]!);
      // OLD behavior: [100, 200] — the column pins beat the Plan pin.
      expect(item!.contribAmounts).toEqual([300, 300]);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (pre-existing bug): the Savings Profiles rail's "Unspent" figure.
//
// savings-allocation-panel.tsx called `paycheck.computeSummary.useQuery()`
// with NO input at all. Server-side, no contributionProfileId means
// fetchContributionProfile returns null — i.e. NO profile is applied, not
// "the globally-active one". So Unspent ignored the active Contribution
// Profile, the active Salary Profile, any Plan pin, and any Plan-level salary
// override. It is now computed inside budget.listProfiles, which resolves
// each profile's own per-column pins.
// ---------------------------------------------------------------------------
describe("budget router — listProfiles computes Unspent under the resolved profiles", () => {
  /** Household whose ACTIVE Contribution Profile is not the raw job default. */
  async function seedHouseholdWithActiveContribProfile() {
    const ctx = await createTestCaller(adminSession);
    const { caller, db } = ctx;
    const seed = seedStandardDataset(db);
    // A payroll contribution that a profile can move — 10% of salary,
    // pre-tax, so changing it visibly moves take-home pay.
    const contrib = await seedPayrollContribAccount(
      db,
      seed.personId,
      seed.jobId,
      {
        contributionMethod: "percent_of_salary",
        contributionValue: "10",
      },
    );
    const contribProfileId = seedContributionProfile(db, {
      name: "Max Out 401k",
      contributionActiveFields: {
        contributionAccounts: {
          [String(contrib.id)]: {
            contributionValue: "25",
            contributionMethod: "percent_of_salary",
          },
        },
      },
    });
    await caller.settings.appSettings.upsert({
      key: "active_contrib_profile_id",
      value: contribProfileId,
    });
    return { ...ctx, seed, contrib, contribProfileId };
  }

  /** The same monthly take-home the client's buildPayrollBreakdown derives. */
  function netMonthlyFrom(
    paycheckData: Awaited<
      ReturnType<
        Awaited<
          ReturnType<typeof createTestCaller>
        >["caller"]["paycheck"]["computeSummary"]
      >
    >,
  ): number {
    let net = 0;
    for (const d of paycheckData.people) {
      const pc = d.paycheck;
      if (!pc || !d.job) continue;
      const perMonth =
        ("budgetPerMonth" in d ? d.budgetPerMonth : null) ??
        pc.periodsPerYear / 12;
      net += pc.netPay * perMonth;
    }
    return net;
  }

  it("matches a directly-parameterized paycheck.computeSummary for the active Contribution Profile", async () => {
    const { caller, contribProfileId, cleanup } =
      await seedHouseholdWithActiveContribProfile();
    try {
      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.isActive)!;

      const reference = await caller.paycheck.computeSummary({
        contributionProfileId: contribProfileId,
      });
      const expectedNet = netMonthlyFrom(reference);

      expect(main.netMonthly).toBeCloseTo(expectedNet, 6);
      expect(main.unspentMonthly).toBeCloseTo(
        expectedNet - main.monthlyTotal - main.monthlySavings,
        6,
      );
    } finally {
      cleanup();
    }
  });

  it("differs from the no-profile figure the panel used to show", async () => {
    const { caller, cleanup } = await seedHouseholdWithActiveContribProfile();
    try {
      const profiles = await caller.budget.listProfiles();
      const main = profiles.find((p) => p.isActive)!;

      // What the old client-side query computed: computeSummary() with no
      // input at all, i.e. no Contribution Profile applied.
      const noProfile = await caller.paycheck.computeSummary();
      const oldNet = netMonthlyFrom(noProfile);
      const oldUnspent = oldNet - main.monthlyTotal - main.monthlySavings;

      expect(main.netMonthly).not.toBeCloseTo(oldNet, 2);
      expect(main.unspentMonthly).not.toBeCloseTo(oldUnspent, 2);
    } finally {
      cleanup();
    }
  });

  it("honors an active Plan's Contribution Profile pin over the globally-active one", async () => {
    const { caller, db, contrib, cleanup } =
      await seedHouseholdWithActiveContribProfile();
    try {
      const planProfileId = seedContributionProfile(db, {
        name: "Plan-Pinned Contributions",
        contributionActiveFields: {
          contributionAccounts: {
            [String(contrib.id)]: {
              contributionValue: "3",
              contributionMethod: "percent_of_salary",
            },
          },
        },
      });

      const [pinned, unpinned] = await Promise.all([
        caller.budget.listProfiles({ planContribProfileId: planProfileId }),
        caller.budget.listProfiles(),
      ]);
      const reference = await caller.paycheck.computeSummary({
        contributionProfileId: planProfileId,
      });

      const pinnedMain = pinned.find((p) => p.isActive)!;
      expect(pinnedMain.netMonthly).toBeCloseTo(netMonthlyFrom(reference), 6);
      expect(pinnedMain.netMonthly).not.toBeCloseTo(
        unpinned.find((p) => p.isActive)!.netMonthly!,
        2,
      );
    } finally {
      cleanup();
    }
  });

  it("honors a Plan-level salary override", async () => {
    const { caller, cleanup } = await seedHouseholdWithActiveContribProfile();
    try {
      const salaryActiveFields = [{ personId: 1, salary: 240000 }];
      const withOverride = await caller.budget.listProfiles({
        salaryActiveFields,
      });
      const without = await caller.budget.listProfiles();
      expect(withOverride.find((p) => p.isActive)!.netMonthly!).toBeGreaterThan(
        without.find((p) => p.isActive)!.netMonthly!,
      );
    } finally {
      cleanup();
    }
  });

  it("returns null Unspent when nobody has a paycheck to compute from", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedBudgetProfile(db, "No Earners", true);
      const profiles = await caller.budget.listProfiles();
      expect(profiles[0]!.netMonthly).toBeNull();
      expect(profiles[0]!.unspentMonthly).toBeNull();
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// duplicateProfile — the What-If tab's "keep this" action
// ---------------------------------------------------------------------------
describe("budget router — duplicateProfile", () => {
  it("copies columns, items and savings allocations but not API/contribution links", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const seed = seedStandardDataset(db);
      const contribProfileId = seedContributionProfile(db, { name: "Pinned" });
      await caller.budget.addColumn({ label: "Travel" });
      await caller.budget.updateColumnMonths({ columnMonths: [9, 3] });
      await caller.budget.updateColumnContributionProfileIds({
        columnContributionProfileIds: [contribProfileId, null],
      });
      // An API-linked + contribution-linked item on the source.
      const contrib = await seedContribAccount(db, seed.personId, {
        contributionMethod: "dollar_amount",
        contributionValue: "600",
        jobId: null,
      });
      await caller.budget.linkContributionAccount({
        budgetItemId: seed.itemIds[0]!,
        contributionAccountId: contrib.id,
      });
      const schema = await getSchema();
      db.update(schema.budgetItems)
        .set({
          apiCategoryId: "ynab-uuid",
          apiCategoryName: "Rent",
          apiSyncDirection: "push",
        })
        .where(eq(schema.budgetItems.id, seed.itemIds[1]!))
        .run();

      const copy = await caller.budget.duplicateProfile({
        sourceProfileId: seed.profileId,
        name: "Sandbox Copy",
      });

      expect(copy.name).toBe("Sandbox Copy");
      // Duplicating is not activating.
      expect(copy.isActive).toBe(false);
      expect(copy.columnLabels).toEqual(["Standard", "Travel"]);
      expect(copy.columnMonths).toEqual([9, 3]);
      // Column pins ARE copied — the duplicate should resolve like its source.
      expect(copy.columnContributionProfileIds).toEqual([
        contribProfileId,
        null,
      ]);

      const copiedItems = await db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, copy.id))
        .all();
      expect(copiedItems).toHaveLength(seed.itemIds.length);
      // API links and contribution links are external-write hazards on a
      // copy — every one of them must be dropped.
      for (const i of copiedItems) {
        expect(i.apiCategoryId).toBeNull();
        expect(i.apiCategoryName).toBeNull();
        expect(i.contributionAccountId).toBeNull();
      }
      // ...while the real budget content survives.
      const rent = copiedItems.find((i) => i.subcategory === "Rent");
      expect(rent).toBeTruthy();
      expect(rent!.isEssential).toBe(true);

      const copiedAllocations = await db
        .select()
        .from(schema.savingsGoalProfileAllocations)
        .where(
          eq(schema.savingsGoalProfileAllocations.budgetProfileId, copy.id),
        )
        .all();
      expect(copiedAllocations).toHaveLength(1);
      expect(Number(copiedAllocations[0]!.monthlyContribution)).toBe(500);
    } finally {
      cleanup();
    }
  });

  it("is gated on the budget permission", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    const viewer = await createTestCaller(viewerSession);
    try {
      const seed = seedStandardDataset(db);
      await expect(
        viewer.caller.budget.duplicateProfile({
          sourceProfileId: seed.profileId,
          name: "Nope",
        }),
      ).rejects.toThrow();
      void caller;
    } finally {
      viewer.cleanup();
      cleanup();
    }
  });

  it("bakes itemAmountActiveFields into the copy, keyed by the SOURCE item ids", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      const schema = await getSchema();
      const seed = seedStandardDataset(db);

      const copy = await caller.budget.duplicateProfile({
        sourceProfileId: seed.profileId,
        name: "Edited Copy",
        itemAmountActiveFields: [
          { itemId: seed.itemIds[0]!, colIndex: 0, amount: 2500 },
        ],
      });

      const copiedItems = await db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, copy.id))
        .all();
      const rent = copiedItems.find((i) => i.subcategory === "Rent");
      const groceries = copiedItems.find((i) => i.subcategory === "Groceries");
      expect((rent!.amounts as number[])[0]).toBe(2500);
      // Untouched items keep the source's raw amount.
      expect((groceries!.amounts as number[])[0]).toBe(600);

      // The source profile itself is unaffected — this is a copy-time bake,
      // never a mutation of the profile being played with.
      const sourceItems = await db
        .select()
        .from(schema.budgetItems)
        .where(eq(schema.budgetItems.profileId, seed.profileId))
        .all();
      const sourceRent = sourceItems.find((i) => i.subcategory === "Rent");
      expect((sourceRent!.amounts as number[])[0]).toBe(2000);
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
