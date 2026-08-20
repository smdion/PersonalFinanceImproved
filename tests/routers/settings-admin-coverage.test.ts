/**
 * Additional settings/admin router coverage tests.
 *
 * Targets uncovered lines in src/server/routers/settings/admin.ts:
 *   - appSettings.list viewer filtering (RBAC keys hidden for non-admins)
 *   - backfillPerformanceAccountIds
 *   - portfolioSnapshots.delete
 *   - scenarios.setOverride / clearOverride
 *   - performanceAccounts.update
 *   - portfolioSnapshots.create
 *
 * The "db.transaction() with async callbacks can't run under better-sqlite3"
 * note that used to be here was wrong for all four procedures above — the
 * test harness's monkey-patched db.transaction() (tests/routers/setup.ts)
 * already handles async callbacks fine. performanceAccounts.update and
 * portfolioSnapshots.create were never actually broken (misdiagnosed, same
 * as resetAllData/T26 before it). scenarios.setOverride/clearOverride WERE
 * genuinely broken — not by the transaction, but because they read the
 * scenario row via raw `tx.execute(sql\`SELECT * FROM scenarios...\`)`,
 * which doesn't exist on the SQLite driver (same root cause as F5) *and*,
 * even after switching to queryRaw(), returned the JSONB `overrides` column
 * as an unparsed string on SQLite (Drizzle's typed .select() JSON-decodes
 * text("...", {mode:"json"}) columns; raw SQL does not). Fixed by switching
 * both to a plain typed tx.select() instead of raw SQL, which is simpler,
 * correct on both dialects, and doesn't lose anything — the raw SQL's
 * claimed "FOR UPDATE" locking was never actually implemented either.
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

// performanceAccounts.create/update additional coverage moved to
// performance.test.ts (procedures moved to routers/performance.ts, Phase 6.4).

describe("portfolioSnapshots.create", () => {
  it("creates a snapshot with no accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.settings.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [],
      });
      expect(result.snapshotDate).toBe("2025-06-15");
    } finally {
      ctx.cleanup();
    }
  });

  it("creates a snapshot with accounts and syncs parentCategory from the linked performance account", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        parentCategory: "Portfolio",
      });
      const result = await ctx.caller.settings.portfolioSnapshots.create({
        snapshotDate: "2025-06-15",
        accounts: [
          {
            institution: "Fidelity",
            taxType: "preTax",
            accountType: "401k",
            amount: "10000",
            ownerPersonId: null,
            performanceAccountId: perfAcctId,
          },
        ],
      });
      expect(result.snapshotDate).toBe("2025-06-15");

      const schema = await import("@/lib/db/schema");
      const { eq } = await import("drizzle-orm");
      const createdAccounts = await ctx.db
        .select()
        .from(schema.portfolioAccounts)
        .where(eq(schema.portfolioAccounts.snapshotId, result.id));
      expect(createdAccounts).toHaveLength(1);
      expect(createdAccounts[0]?.parentCategory).toBe("Portfolio");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("scenarios.setOverride / clearOverride", () => {
  async function seedScenario(
    ctx: Awaited<ReturnType<typeof createTestCaller>>,
    overrides: Record<string, unknown> = {},
  ) {
    return ctx.db
      .insert(schema.scenarios)
      .values({ name: "Test Scenario", overrides, isBaseline: false })
      .returning({ id: schema.scenarios.id })
      .get().id;
  }

  it("setOverride adds a new override to an empty scenario", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const id = await seedScenario(ctx, {});
      const result = await ctx.caller.settings.scenarios.setOverride({
        id,
        entity: "people",
        recordId: "1",
        field: "salary",
        value: 150000,
      });
      const overrides = result?.overrides as Record<string, unknown>;
      expect(
        (overrides.people as Record<string, Record<string, unknown>>)["1"]
          ?.salary,
      ).toBe(150000);
    } finally {
      ctx.cleanup();
    }
  });

  it("setOverride merges into existing overrides without clobbering unrelated fields", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const id = await seedScenario(ctx, {
        people: { "1": { salary: 100000, retirementAge: 62 } },
      });
      const result = await ctx.caller.settings.scenarios.setOverride({
        id,
        entity: "people",
        recordId: "1",
        field: "salary",
        value: 120000,
      });
      const person = (
        result?.overrides as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      ).people["1"];
      expect(person?.salary).toBe(120000);
      expect(person?.retirementAge).toBe(62);
    } finally {
      ctx.cleanup();
    }
  });

  it("clearOverride removes a single field, leaving siblings intact", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const id = await seedScenario(ctx, {
        people: { "1": { salary: 100000, retirementAge: 62 } },
      });
      const result = await ctx.caller.settings.scenarios.clearOverride({
        id,
        entity: "people",
        recordId: "1",
        field: "salary",
      });
      const person = (
        result?.overrides as Record<
          string,
          Record<string, Record<string, unknown>>
        >
      ).people["1"];
      expect(person?.salary).toBeUndefined();
      expect(person?.retirementAge).toBe(62);
    } finally {
      ctx.cleanup();
    }
  });

  it("setOverride throws for a non-existent scenario id", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      await expect(
        ctx.caller.settings.scenarios.setOverride({
          id: 999999,
          entity: "people",
          recordId: "1",
          field: "salary",
          value: 100000,
        }),
      ).rejects.toThrow();
    } finally {
      ctx.cleanup();
    }
  });
});
