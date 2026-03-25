/**
 * Additional settings/admin router coverage tests.
 *
 * Targets uncovered lines in src/server/routers/settings/admin.ts:
 *   - appSettings.list viewer filtering (RBAC keys hidden for non-admins)
 *   - backfillPerformanceAccountIds
 *   - portfolioSnapshots.delete
 *   - scenarios.setOverride / clearOverride (uses db.transaction — skipped, noted below)
 *   - performanceAccounts.update (uses db.transaction — skipped, noted below)
 *   - portfolioSnapshots.create (uses db.transaction — skipped, noted below)
 *
 * NOTE: Procedures using db.transaction() with async callbacks cannot be tested
 * with better-sqlite3 because SQLite's transaction() requires synchronous callbacks.
 * Affected: performanceAccounts.update, portfolioSnapshots.create,
 * scenarios.setOverride, scenarios.clearOverride
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedPerformanceAccount,
  seedSnapshot,
  seedAppSetting,
  adminSession,
  viewerSession,
} from "./setup";
import * as schema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
  getApiConnection: vi.fn().mockResolvedValue(null),
  cacheClear: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS — viewer filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.appSettings.list viewer filtering", () => {
  it("admin sees RBAC settings", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      seedAppSetting(ctx.db, "rbac_admin_group", "my-admin-group");
      seedAppSetting(ctx.db, "rbac_group_scenario", "scenario-editors");
      seedAppSetting(ctx.db, "normal_setting", "visible");

      const rows = await ctx.caller.settings.appSettings.list();
      const keys = rows.map((r: { key: string }) => r.key);
      expect(keys).toContain("rbac_admin_group");
      expect(keys).toContain("rbac_group_scenario");
      expect(keys).toContain("normal_setting");
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer does not see RBAC settings", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      seedAppSetting(ctx.db, "rbac_admin_group", "my-admin-group");
      seedAppSetting(ctx.db, "rbac_group_scenario", "scenario-editors");
      seedAppSetting(ctx.db, "normal_setting", "visible");

      const rows = await ctx.caller.settings.appSettings.list();
      const keys = rows.map((r: { key: string }) => r.key);
      expect(keys).not.toContain("rbac_admin_group");
      expect(keys).not.toContain("rbac_group_scenario");
      expect(keys).toContain("normal_setting");
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL PERFORMANCE ACCOUNT IDS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.backfillPerformanceAccountIds", () => {
  it("returns zero updates when no contribution accounts exist", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(0);
      expect(result.unmatched).toEqual([]);
      expect(result.alreadyLinked).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it("links matching contribution account to performance account", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Alice", "1990-01-01");
      const _perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
        accountType: "401k",
        ownerPersonId: personId,
      });

      // Insert contribution account with correct schema fields
      ctx.db
        .insert(schema.contributionAccounts)
        .values({
          personId,
          accountType: "401k",
          taxTreatment: "pre_tax",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
          employerMatchType: "none",
          isActive: true,
          performanceAccountId: null,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
    }
  });

  it("reports unmatched contribution accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Bob", "1985-06-15");

      // Insert contribution account for HSA with no matching perf account
      ctx.db
        .insert(schema.contributionAccounts)
        .values({
          personId,
          accountType: "hsa",
          taxTreatment: "pre_tax",
          contributionMethod: "dollar_amount",
          contributionValue: "200",
          employerMatchType: "none",
          isActive: true,
          performanceAccountId: null,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.unmatched.length).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
    }
  });

  it("counts already linked accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Carol", "1992-03-20");
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Schwab",
        accountType: "brokerage",
        ownerPersonId: personId,
      });

      // Already linked
      ctx.db
        .insert(schema.contributionAccounts)
        .values({
          personId,
          accountType: "brokerage",
          taxTreatment: "after_tax",
          contributionMethod: "dollar_amount",
          contributionValue: "500",
          employerMatchType: "none",
          isActive: true,
          performanceAccountId: perfAcctId,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.alreadyLinked).toBeGreaterThanOrEqual(1);
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO SNAPSHOTS — delete
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.portfolioSnapshots.delete", () => {
  it("deletes an existing snapshot", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
        accountType: "401k",
      });
      const snapId = seedSnapshot(ctx.db, "2026-06-01", [
        {
          performanceAccountId: perfAcctId,
          amount: "50000",
          taxType: "preTax",
        },
      ]);

      await ctx.caller.settings.portfolioSnapshots.delete({ id: snapId });

      const latest = await ctx.caller.settings.portfolioSnapshots.getLatest();
      expect(latest).toBeNull();
    } finally {
      ctx.cleanup();
    }
  });

  it("is idempotent for non-existent snapshot", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      await expect(
        ctx.caller.settings.portfolioSnapshots.delete({ id: 99999 }),
      ).resolves.toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateDataFreshness — additional branches
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.updateDataFreshness additional", () => {
  it("returns ok:true with no input fields", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.settings.updateDataFreshness({});
      expect(result).toEqual({ ok: true });
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RELOCATION SCENARIOS — additional coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.relocationScenarios additional", () => {
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
      const result = await ctx.caller.settings.relocationScenarios.save({
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

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE ACCOUNTS — create with subType and label
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.performanceAccounts.create additional", () => {
  it("creates account with subType and displayName", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Frank", "1991-01-01");
      const result = await ctx.caller.settings.performanceAccounts.create({
        institution: "Fidelity",
        accountType: "401k",
        subType: "Roth",
        label: "Roth 401k",
        displayName: "Frank Fidelity Roth 401k",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 5,
      });
      expect(result).toBeDefined();
      expect(result!.subType).toBe("Roth");
      expect(result!.label).toBe("Roth 401k");
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTE on skipped procedures
// ─────────────────────────────────────────────────────────────────────────────
// The following procedures use db.transaction() with async callbacks, which
// better-sqlite3's synchronous transaction() does not support:
//   - performanceAccounts.update (lines 600-662)
//   - portfolioSnapshots.create (lines 709-982)
//   - scenarios.setOverride (lines 284-307)
//   - scenarios.clearOverride (lines 319-352)
// These must be tested against a real PostgreSQL database.
