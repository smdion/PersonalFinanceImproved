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

// portfolioSnapshots.delete/create additional coverage moved to
// networth.test.ts (procedures moved to routers/networth.ts).

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

// relocationScenarios additional coverage moved to
// projection-relocation.test.ts (procedures moved to
// routers/projection/relocation.ts).

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
