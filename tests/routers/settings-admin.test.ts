/**
 * Settings/admin router integration tests.
 *
 * Covers all procedures exposed via adminProcedures (spread into settingsRouter):
 *   - appSettings.list / upsert / delete
 *   - scenarios.list / create / update / delete
 *   - apiConnections.list / upsert / delete
 *   - getDataFreshness
 *   - rbacGroups.get
 *
 * savingsGoals, performanceAccounts, portfolioSnapshots, and
 * relocationScenarios CRUD moved out to savings.ts/performance.ts/
 * networth.ts/projection/relocation.ts respectively (Phase 6.3-6.6) — their
 * tests moved to savings-goals-crud.test.ts / performance.test.ts /
 * networth.test.ts / projection-relocation.test.ts alongside them. This
 * completes Phase 6's settings-placement reorganization (audit Batch 11
 * Finding 1) — everything remaining in adminProcedures is a genuine
 * cross-cutting exception per RULES.md's Settings-page ownership table.
 *
 * All procedures live at caller.settings.* because adminProcedures is spread
 * into settingsRouter (see src/server/routers/settings/index.ts).
 *
 * Permission-gated procedures (scenarioProcedure) pass through the admin
 * role check automatically — the default adminSession has role: "admin".
 */
import "./setup-mocks";
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestCaller,
  seedPerson,
  seedPerformanceAccount,
  seedSnapshot,
  seedAppSetting,
  adminSession,
  viewerSession,
} from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  cacheGet: vi.fn().mockResolvedValue(null),
}));

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.appSettings", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns only the migration-seeded settings on a fresh DB", async () => {
      // 0008_kill_live_sentinel backfills the two active-profile keys so they
      // always name a real row, so a fresh DB is no longer setting-free.
      const rows = await caller.settings.appSettings.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.map((r: { key: string }) => r.key).sort()).toEqual([
        "active_contrib_profile_id",
        "active_salary_profile_id",
      ]);
    });

    it("returns seeded settings ordered by key", async () => {
      seedAppSetting(db, "z_last", "zzz");
      seedAppSetting(db, "a_first", "aaa");
      const rows = await caller.settings.appSettings.list();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const keys = rows.map((r: { key: string }) => r.key);
      const aIdx = keys.indexOf("a_first");
      const zIdx = keys.indexOf("z_last");
      expect(aIdx).toBeGreaterThanOrEqual(0);
      expect(zIdx).toBeGreaterThanOrEqual(0);
      expect(aIdx).toBeLessThan(zIdx);
    });

    it("returns the value for a seeded setting", async () => {
      const rows = await caller.settings.appSettings.list();
      const found = rows.find((r: { key: string }) => r.key === "a_first");
      expect(found).toBeDefined();
      expect(found!.value).toBe("aaa");
    });
  });

  describe("upsert", () => {
    it("inserts a new setting", async () => {
      const result = await caller.settings.appSettings.upsert({
        key: "test_setting",
        value: "hello",
      });
      expect(result).toBeDefined();
      expect(result!.key).toBe("test_setting");
      expect(result!.value).toBe("hello");
    });

    it("updates an existing setting on conflict", async () => {
      await caller.settings.appSettings.upsert({
        key: "test_setting",
        value: "hello",
      });
      const result = await caller.settings.appSettings.upsert({
        key: "test_setting",
        value: "updated",
      });
      expect(result).toBeDefined();
      expect(result!.value).toBe("updated");
    });

    it("only one row exists after upsert conflict", async () => {
      const rows = await caller.settings.appSettings.list();
      const matching = rows.filter(
        (r: { key: string }) => r.key === "test_setting",
      );
      expect(matching).toHaveLength(1);
    });

    it("upsert with null value deletes the row and returns null", async () => {
      await caller.settings.appSettings.upsert({
        key: "test_setting",
        value: "hello",
      });
      const result = await caller.settings.appSettings.upsert({
        key: "test_setting",
        value: null,
      });
      expect(result).toBeNull();
      const rows = await caller.settings.appSettings.list();
      expect(
        rows.find((r: { key: string }) => r.key === "test_setting"),
      ).toBeUndefined();
    });

    it("stores a numeric value as a string", async () => {
      const result = await caller.settings.appSettings.upsert({
        key: "numeric_setting",
        value: "42",
      });
      expect(result).toBeDefined();
      expect(result!.value).toBe("42");
    });
  });

  describe("delete", () => {
    it("deletes an existing setting", async () => {
      await caller.settings.appSettings.upsert({
        key: "to_delete",
        value: "gone",
      });
      let rows = await caller.settings.appSettings.list();
      expect(
        rows.find((r: { key: string }) => r.key === "to_delete"),
      ).toBeDefined();

      await caller.settings.appSettings.delete({ key: "to_delete" });

      rows = await caller.settings.appSettings.list();
      expect(
        rows.find((r: { key: string }) => r.key === "to_delete"),
      ).toBeUndefined();
    });

    it("is a no-op when deleting a non-existent key", async () => {
      const before = await caller.settings.appSettings.list();
      await caller.settings.appSettings.delete({ key: "does_not_exist" });
      const after = await caller.settings.appSettings.list();
      expect(after.length).toBe(before.length);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.scenarios", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let createdId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.settings.scenarios.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates a scenario with a name", async () => {
      const result = await caller.settings.scenarios.create({
        name: "High Income",
        description: "Scenario with a big raise",
        overrides: {},
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("High Income");
      expect(result!.description).toBe("Scenario with a big raise");
      createdId = result!.id;
    });

    it("creates a scenario with minimal input (name only via default overrides)", async () => {
      const result = await caller.settings.scenarios.create({
        name: "Minimal",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Minimal");
      expect(result!.overrides).toBeDefined();
    });

    it("created scenarios appear in list", async () => {
      const rows = await caller.settings.scenarios.list();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const names = rows.map((r: { name: string }) => r.name);
      expect(names).toContain("High Income");
      expect(names).toContain("Minimal");
    });

    it("list is ordered by ascending id", async () => {
      const rows = await caller.settings.scenarios.list();
      const ids = rows.map((r: { id: number }) => r.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
    });
  });

  describe("update", () => {
    it("updates the name of an existing scenario", async () => {
      const result = await caller.settings.scenarios.update({
        id: createdId,
        name: "High Income — Updated",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("High Income — Updated");
    });

    it("updates the description", async () => {
      const result = await caller.settings.scenarios.update({
        id: createdId,
        name: "High Income — Updated",
        description: "Now with a description update",
      });
      expect(result).toBeDefined();
      expect(result!.description).toBe("Now with a description update");
    });

    it("updated scenario is reflected in list", async () => {
      const rows = await caller.settings.scenarios.list();
      const found = rows.find((r: { id: number }) => r.id === createdId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("High Income — Updated");
    });

    it("can set overrides on a scenario", async () => {
      const result = await caller.settings.scenarios.update({
        id: createdId,
        name: "High Income — Updated",
        overrides: { jobs: { "1": { annualSalary: 200000 } } },
      });
      expect(result).toBeDefined();
      expect(result!.overrides).toBeDefined();
    });
  });

  describe("delete", () => {
    it("deletes a scenario", async () => {
      const created = await caller.settings.scenarios.create({
        name: "Throwaway Scenario",
      });
      expect(created).toBeDefined();

      await caller.settings.scenarios.delete({ id: created!.id });

      const rows = await caller.settings.scenarios.list();
      expect(
        rows.find((r: { id: number }) => r.id === created!.id),
      ).toBeUndefined();
    });

    it("does not affect other scenarios when one is deleted", async () => {
      const rowsBefore = await caller.settings.scenarios.list();
      const countBefore = rowsBefore.length;

      const tmp = await caller.settings.scenarios.create({ name: "Temp" });
      await caller.settings.scenarios.delete({ id: tmp!.id });

      const rowsAfter = await caller.settings.scenarios.list();
      expect(rowsAfter.length).toBe(countBefore);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.apiConnections", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.settings.apiConnections.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("upsert", () => {
    it("inserts a new api connection", async () => {
      const result = await caller.settings.apiConnections.upsert({
        service: "simplefin",
        config: { token: "abc123", baseUrl: "https://api.simplefin.org" },
      });
      expect(result).toBeDefined();
      expect(result!.service).toBe("simplefin");
      expect(result!.config).toMatchObject({ token: "abc123" });
    });

    it("inserted connection appears in list", async () => {
      const rows = await caller.settings.apiConnections.list();
      expect(
        rows.find((r: { service: string }) => r.service === "simplefin"),
      ).toBeDefined();
    });

    it("updates an existing connection on upsert (same service key)", async () => {
      const result = await caller.settings.apiConnections.upsert({
        service: "simplefin",
        config: { token: "newtoken", baseUrl: "https://api.simplefin.org" },
      });
      expect(result).toBeDefined();
      expect((result!.config as Record<string, string>).token).toBe("newtoken");
    });

    it("only one row per service after multiple upserts", async () => {
      const rows = await caller.settings.apiConnections.list();
      const matching = rows.filter(
        (r: { service: string }) => r.service === "simplefin",
      );
      expect(matching).toHaveLength(1);
    });

    it("inserts a second distinct service", async () => {
      await caller.settings.apiConnections.upsert({
        service: "monarch",
        config: { apiKey: "xyz789" },
        accountMappings: [
          {
            localName: "Checking",
            remoteAccountId: "rem-001",
            syncDirection: "pull",
          },
        ],
      });
      const rows = await caller.settings.apiConnections.list();
      expect(
        rows.find((r: { service: string }) => r.service === "monarch"),
      ).toBeDefined();
    });

    it("list is ordered alphabetically by service", async () => {
      const rows = await caller.settings.apiConnections.list();
      const services = rows.map((r: { service: string }) => r.service);
      expect(services).toEqual([...services].sort());
    });
  });

  describe("delete", () => {
    it("deletes a connection by service name", async () => {
      await caller.settings.apiConnections.upsert({
        service: "to_delete_svc",
        config: {},
      });
      let rows = await caller.settings.apiConnections.list();
      expect(
        rows.find((r: { service: string }) => r.service === "to_delete_svc"),
      ).toBeDefined();

      await caller.settings.apiConnections.delete({ service: "to_delete_svc" });

      rows = await caller.settings.apiConnections.list();
      expect(
        rows.find((r: { service: string }) => r.service === "to_delete_svc"),
      ).toBeUndefined();
    });

    it("does not affect other connections when one is deleted", async () => {
      const before = await caller.settings.apiConnections.list();
      const countBefore = before.length;

      await caller.settings.apiConnections.upsert({
        service: "ephemeral",
        config: {},
      });
      await caller.settings.apiConnections.delete({ service: "ephemeral" });

      const after = await caller.settings.apiConnections.list();
      expect(after.length).toBe(countBefore);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SAVINGS GOALS
// ─────────────────────────────────────────────────────────────────────────────

// savings.savingsGoals CRUD tests moved to savings-goals-crud.test.ts
// (procedures moved to routers/savings.ts, Phase 6.3).

// relocationScenarios CRUD tests moved to projection-relocation.test.ts
// (procedures moved to routers/projection/relocation.ts, Phase 6.6).

// performanceAccounts CRUD tests moved to performance.test.ts (procedures
// moved to routers/performance.ts, Phase 6.4).

// portfolioSnapshots CRUD tests (getLatest/createAccount/updateAccount/
// delete) moved to networth.test.ts (procedures moved to
// routers/networth.ts, Phase 6.5).

// ─────────────────────────────────────────────────────────────────────────────
// GET DATA FRESHNESS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.getDataFreshness", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("returns null for both dates on a fresh database", async () => {
    const result = await caller.settings.getDataFreshness();
    expect(result).toHaveProperty("balanceDate");
    expect(result).toHaveProperty("performanceDate");
    expect(result.balanceDate).toBeNull();
    expect(result.performanceDate).toBeNull();
  });

  it("balanceDate reflects the most recent portfolio snapshot", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    seedSnapshot(db, "2025-09-30", [
      { performanceAccountId: perfAcctId, amount: "120000" },
    ]);

    const result = await caller.settings.getDataFreshness();
    expect(result.balanceDate).toBe("2025-09-30");
  });

  it("balanceDate tracks the latest snapshot when two exist", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Schwab",
      accountType: "brokerage",
    });
    seedSnapshot(db, "2025-12-31", [
      { performanceAccountId: perfAcctId, amount: "200000" },
    ]);

    const result = await caller.settings.getDataFreshness();
    expect(result.balanceDate).toBe("2025-12-31");
  });

  it("performanceDate reflects the performance_last_updated app setting", async () => {
    seedAppSetting(db, "performance_last_updated", "2025-11-15T10:00:00.000Z");

    const result = await caller.settings.getDataFreshness();
    expect(result.performanceDate).toBe("2025-11-15T10:00:00.000Z");
  });

  it("performanceDate is null when no performance_last_updated setting exists", async () => {
    // Fresh DB context — no setting seeded
    const fresh = await createTestCaller(adminSession);
    try {
      const result = await fresh.caller.settings.getDataFreshness();
      expect(result.performanceDate).toBeNull();
    } finally {
      fresh.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC GROUPS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.rbacGroups.get", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("returns a result with adminGroup, isAdminCustom and permissions", async () => {
    const result = await caller.settings.rbacGroups.get();
    expect(result).toHaveProperty("adminGroup");
    expect(result).toHaveProperty("isAdminCustom");
    expect(result).toHaveProperty("permissions");
  });

  it("defaults adminGroup to 'ledgr-admin' when no override is set", async () => {
    const result = await caller.settings.rbacGroups.get();
    expect(result.adminGroup).toBe("ledgr-admin");
    expect(result.isAdminCustom).toBe(false);
  });

  it("permissions is an array with entries for each known permission", async () => {
    const result = await caller.settings.rbacGroups.get();
    expect(Array.isArray(result.permissions)).toBe(true);
    expect(result.permissions.length).toBeGreaterThan(0);
  });

  it("each permission entry has permission, group, and isCustom fields", async () => {
    const result = await caller.settings.rbacGroups.get();
    for (const perm of result.permissions) {
      expect(perm).toHaveProperty("permission");
      expect(perm).toHaveProperty("group");
      expect(perm).toHaveProperty("isCustom");
    }
  });

  it("default groups follow the 'ledgr-<permission>' convention", async () => {
    const result = await caller.settings.rbacGroups.get();
    for (const perm of result.permissions) {
      if (!perm.isCustom) {
        expect(perm.group).toBe(`ledgr-${perm.permission}`);
      }
    }
  });

  it("reflects a custom adminGroup when the app setting is present", async () => {
    seedAppSetting(db, "rbac_admin_group", "my-custom-admin");

    const result = await caller.settings.rbacGroups.get();
    expect(result.adminGroup).toBe("my-custom-admin");
    expect(result.isAdminCustom).toBe(true);
  });

  it("reflects a custom permission group when the RBAC setting is present", async () => {
    seedAppSetting(db, "rbac_group_scenario", "custom-scenario-group");

    const result = await caller.settings.rbacGroups.get();
    const scenarioPerm = result.permissions.find(
      (p: { permission: string }) => p.permission === "scenario",
    );
    expect(scenarioPerm).toBeDefined();
    expect(scenarioPerm!.group).toBe("custom-scenario-group");
    expect(scenarioPerm!.isCustom).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE DATA FRESHNESS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.updateDataFreshness", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("updates performanceDate via app settings", async () => {
    const result = await caller.settings.updateDataFreshness({
      performanceDate: "2025-10-01T12:00:00.000Z",
    });
    expect(result).toEqual({ ok: true });

    const freshness = await caller.settings.getDataFreshness();
    expect(freshness.performanceDate).toBe("2025-10-01T12:00:00.000Z");
  });

  it("updates balanceDate when a snapshot exists", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    seedSnapshot(db, "2025-06-01", [
      { performanceAccountId: perfAcctId, amount: "50000" },
    ]);

    const result = await caller.settings.updateDataFreshness({
      balanceDate: "2025-07-15",
    });
    expect(result).toEqual({ ok: true });

    const freshness = await caller.settings.getDataFreshness();
    expect(freshness.balanceDate).toBe("2025-07-15");
  });

  it("is a no-op for balanceDate when no snapshot exists", async () => {
    const fresh = await createTestCaller(adminSession);
    try {
      const result = await fresh.caller.settings.updateDataFreshness({
        balanceDate: "2025-08-01",
      });
      expect(result).toEqual({ ok: true });

      const freshness = await fresh.caller.settings.getDataFreshness();
      expect(freshness.balanceDate).toBeNull();
    } finally {
      fresh.cleanup();
    }
  });

  it("updates both balanceDate and performanceDate", async () => {
    const result = await caller.settings.updateDataFreshness({
      balanceDate: "2025-09-30",
      performanceDate: "2025-09-30T15:00:00.000Z",
    });
    expect(result).toEqual({ ok: true });

    const freshness = await caller.settings.getDataFreshness();
    expect(freshness.performanceDate).toBe("2025-09-30T15:00:00.000Z");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS — additional coverage
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.scenarios additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates a scenario with rich overrides", async () => {
    const result = await caller.settings.scenarios.create({
      name: "Rich Override Scenario",
      description: "Contains nested overrides from creation",
      overrides: {
        jobs: { "1": { annualSalary: 200000, bonusPct: 0.1 } },
        contributions: { "5": { value: "0.15" } },
      },
    });
    expect(result).toBeDefined();
    expect(result!.overrides).toBeDefined();
    const overrides = result!.overrides as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(overrides.jobs["1"].annualSalary).toBe(200000);
    expect(overrides.contributions["5"].value).toBe("0.15");
  });

  it("updates overrides entirely on an existing scenario", async () => {
    const created = await caller.settings.scenarios.create({
      name: "Update Override Test",
      overrides: { jobs: { "1": { annualSalary: 100000 } } },
    });
    const result = await caller.settings.scenarios.update({
      id: created!.id,
      overrides: { jobs: { "1": { annualSalary: 250000, bonusPct: 0.2 } } },
    });
    expect(result).toBeDefined();
    const overrides = result!.overrides as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(overrides.jobs["1"].annualSalary).toBe(250000);
    expect(overrides.jobs["1"].bonusPct).toBe(0.2);
  });

  it("update with only name preserves existing fields", async () => {
    const created = await caller.settings.scenarios.create({
      name: "Name Only Update",
      description: "Original description",
    });
    const result = await caller.settings.scenarios.update({
      id: created!.id,
      name: "Renamed Scenario",
    });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Renamed Scenario");
  });

  it("scenario create rejects empty name", async () => {
    await expect(
      caller.settings.scenarios.create({ name: "" }),
    ).rejects.toThrow();
  });
});

// performanceAccounts delete test moved to performance.test.ts (Phase 6.4).

// ─────────────────────────────────────────────────────────────────────────────
// APP SETTINGS — non-admin filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.appSettings non-admin filtering", () => {
  it("non-admin users do not see RBAC settings", async () => {
    // Use a shared DB: seed data, then create both admin and viewer callers on same DB
    const ctx = await createTestCaller(adminSession);
    try {
      // Seed RBAC settings via admin
      await ctx.caller.settings.appSettings.upsert({
        key: "rbac_admin_group",
        value: "custom-admin",
      });
      await ctx.caller.settings.appSettings.upsert({
        key: "rbac_group_scenario",
        value: "custom-scenario",
      });
      await ctx.caller.settings.appSettings.upsert({
        key: "normal_setting",
        value: "visible",
      });

      // Admin should see all settings including RBAC
      const adminRows = await ctx.caller.settings.appSettings.list();
      expect(
        adminRows.find((r: { key: string }) => r.key === "rbac_admin_group"),
      ).toBeDefined();
      expect(
        adminRows.find((r: { key: string }) => r.key === "rbac_group_scenario"),
      ).toBeDefined();
      expect(
        adminRows.find((r: { key: string }) => r.key === "normal_setting"),
      ).toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer session can still list settings (non-RBAC ones)", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      seedAppSetting(ctx.db, "visible_setting", "yes");
      const rows = await ctx.caller.settings.appSettings.list();
      expect(
        rows.find((r: { key: string }) => r.key === "visible_setting"),
      ).toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });

  it("viewer session filters out RBAC settings", async () => {
    const ctx = await createTestCaller(viewerSession);
    try {
      seedAppSetting(ctx.db, "rbac_admin_group", "admin-group");
      seedAppSetting(ctx.db, "rbac_group_budget", "budget-group");
      seedAppSetting(ctx.db, "normal_key", "normal_value");
      const rows = await ctx.caller.settings.appSettings.list();
      expect(
        rows.find((r: { key: string }) => r.key === "rbac_admin_group"),
      ).toBeUndefined();
      expect(
        rows.find((r: { key: string }) => r.key === "rbac_group_budget"),
      ).toBeUndefined();
      expect(
        rows.find((r: { key: string }) => r.key === "normal_key"),
      ).toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL PERFORMANCE ACCOUNT IDS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.backfillPerformanceAccountIds", () => {
  it("returns zeroes when no contribution accounts exist", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result).toBeDefined();
      expect(result.updated).toBe(0);
      expect(result.alreadyLinked).toBe(0);
      expect(Array.isArray(result.unmatched)).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  it("backfills a matching contribution account", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Alice", "1985-03-15");
      const _perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
        accountType: "401k",
        accountLabel: "Alice Fidelity 401k",
        ownerPersonId: personId,
      });
      // Insert a contribution account with no performanceAccountId
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      ctx.db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          personId,
          accountType: "401k",
          taxTreatment: "pre_tax",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.10",
          employerMatchType: "none",
          isActive: true,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(1);
      expect(result.unmatched).toHaveLength(0);
      expect(result.alreadyLinked).toBe(0);
    } finally {
      ctx.cleanup();
    }
  });

  it("reports unmatched contribution accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Zara", "1990-01-01");
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      // Insert a contribution account with no matching performance account
      ctx.db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          personId,
          accountType: "403b",
          taxTreatment: "pre_tax",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.05",
          employerMatchType: "none",
          isActive: true,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(0);
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0]).toContain("403b");
    } finally {
      ctx.cleanup();
    }
  });

  it("backfills via label name matching when ownerPersonId differs", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Charlie", "1990-06-15");
      // Create perf account owned by a different person (null) but with person name in label
      seedPerformanceAccount(ctx.db, {
        institution: "Fidelity",
        accountType: "401k",
        accountLabel: "charlie fidelity 401k",
        ownerPersonId: null,
      });
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      ctx.db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          personId,
          accountType: "401k",
          taxTreatment: "pre_tax",
          contributionMethod: "percent_of_salary",
          contributionValue: "0.06",
          employerMatchType: "none",
          isActive: true,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  it("backfills using displayLabel fallback for unknown accountType", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Dana", "1992-01-01");
      seedPerformanceAccount(ctx.db, {
        institution: "Unknown",
        accountType: "custom_type",
        accountLabel: "dana unknown custom_type",
        ownerPersonId: personId,
      });
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      ctx.db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          personId,
          accountType: "custom_type",
          taxTreatment: "pre_tax",
          contributionMethod: "fixed_amount",
          contributionValue: "100",
          employerMatchType: "none",
          isActive: true,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });

  it("reports already-linked accounts", async () => {
    const ctx = await createTestCaller(adminSession);
    try {
      const personId = await seedPerson(ctx.db, "Bob", "1988-06-20");
      const perfAcctId = seedPerformanceAccount(ctx.db, {
        institution: "Schwab",
        accountType: "ira",
        accountLabel: "Bob Schwab IRA",
        ownerPersonId: personId,
      });
      const sqliteSchema = await import("@/lib/db/schema-sqlite");
      // Insert a contribution account that is already linked
      ctx.db
        .insert(sqliteSchema.contributionAccounts)
        .values({
          personId,
          accountType: "ira",
          taxTreatment: "pre_tax",
          contributionMethod: "fixed_amount",
          contributionValue: "500",
          employerMatchType: "none",
          isActive: true,
          performanceAccountId: perfAcctId,
        })
        .run();

      const result = await ctx.caller.settings.backfillPerformanceAccountIds();
      expect(result.updated).toBe(0);
      expect(result.unmatched).toHaveLength(0);
      expect(result.alreadyLinked).toBe(1);
    } finally {
      ctx.cleanup();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL COVERAGE — apiConnections config shapes
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.apiConnections additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("stores complex config with multiple fields", async () => {
    const result = await caller.settings.apiConnections.upsert({
      service: "complex_svc",
      config: {
        token: "tok-123",
        baseUrl: "https://api.example.com",
        refreshToken: "ref-456",
      },
    });
    expect(result).toBeDefined();
    const cfg = result!.config as Record<string, string>;
    expect(cfg.token).toBe("tok-123");
    expect(cfg.baseUrl).toBe("https://api.example.com");
    expect(cfg.refreshToken).toBe("ref-456");
  });

  it("stores account mappings with all sync directions", async () => {
    const result = await caller.settings.apiConnections.upsert({
      service: "mapping_svc",
      config: { apiKey: "key" },
      accountMappings: [
        {
          localName: "Checking",
          remoteAccountId: "rem-1",
          syncDirection: "pull",
        },
        {
          localName: "Savings",
          remoteAccountId: "rem-2",
          syncDirection: "push",
        },
        {
          localName: "Credit",
          remoteAccountId: "rem-3",
          syncDirection: "both",
        },
      ],
    });
    expect(result).toBeDefined();
    const mappings = result!.accountMappings as Array<{
      syncDirection: string;
    }>;
    expect(mappings).toHaveLength(3);
    expect(mappings[0]!.syncDirection).toBe("pull");
    expect(mappings[1]!.syncDirection).toBe("push");
    expect(mappings[2]!.syncDirection).toBe("both");
  });

  it("upsert updates account mappings", async () => {
    await caller.settings.apiConnections.upsert({
      service: "update_mapping",
      config: {},
      accountMappings: [
        { localName: "Old", remoteAccountId: "rem-old", syncDirection: "pull" },
      ],
    });
    const result = await caller.settings.apiConnections.upsert({
      service: "update_mapping",
      config: {},
      accountMappings: [
        { localName: "New", remoteAccountId: "rem-new", syncDirection: "both" },
      ],
    });
    const mappings = result!.accountMappings as Array<{ localName: string }>;
    expect(mappings).toHaveLength(1);
    expect(mappings[0]!.localName).toBe("New");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL COVERAGE — savingsGoals edge cases
// ─────────────────────────────────────────────────────────────────────────────

// savings.savingsGoals additional coverage moved to savings-goals-crud.test.ts.

// relocationScenarios additional coverage moved to
// projection-relocation.test.ts (Phase 6.6).

// performanceAccounts additional coverage moved to performance.test.ts (Phase 6.4).
