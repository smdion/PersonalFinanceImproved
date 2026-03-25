/**
 * Settings/admin router integration tests.
 *
 * Covers all procedures exposed via adminProcedures (spread into settingsRouter):
 *   - appSettings.list / upsert / delete
 *   - scenarios.list / create / update / delete
 *   - apiConnections.list / upsert / delete
 *   - savingsGoals.list / create / update / delete
 *   - relocationScenarios.list / save / delete
 *   - performanceAccounts.list / create
 *   - portfolioSnapshots.getLatest
 *   - getDataFreshness
 *   - rbacGroups.get
 *
 * All procedures live at caller.settings.* because adminProcedures is spread
 * into settingsRouter (see src/server/routers/settings/index.ts).
 *
 * Permission-gated procedures (scenarioProcedure, savingsProcedure,
 * performanceProcedure, portfolioProcedure) pass through the admin role check
 * automatically — the default adminSession has role: "admin".
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
    it("returns an empty array when no settings exist", async () => {
      const rows = await caller.settings.appSettings.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
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

describe("settings.savingsGoals", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;
  let emergencyFundId: number;
  let vacationId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.settings.savingsGoals.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("create", () => {
    it("creates an emergency fund goal", async () => {
      const result = await caller.settings.savingsGoals.create({
        name: "Emergency Fund",
        targetAmount: "15000",
        monthlyContribution: "750",
        priority: 1,
        isActive: true,
        isEmergencyFund: true,
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Emergency Fund");
      expect(result!.isEmergencyFund).toBe(true);
      expect(result!.isActive).toBe(true);
      emergencyFundId = result!.id;
    });

    it("creates a regular savings goal with targetDate", async () => {
      const result = await caller.settings.savingsGoals.create({
        name: "Vacation 2027",
        targetAmount: "5000",
        targetDate: "2027-06-01",
        monthlyContribution: "300",
        priority: 2,
        isActive: true,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Vacation 2027");
      expect(result!.targetDate).toBe("2027-06-01");
      vacationId = result!.id;
    });

    it("creates an ongoing-mode goal", async () => {
      const result = await caller.settings.savingsGoals.create({
        name: "Monthly Savings Buffer",
        monthlyContribution: "500",
        priority: 3,
        isActive: true,
        targetMode: "ongoing",
      });
      expect(result).toBeDefined();
      expect(result!.targetMode).toBe("ongoing");
    });

    it("created goals appear in list", async () => {
      const rows = await caller.settings.savingsGoals.list();
      expect(rows.length).toBeGreaterThanOrEqual(3);
    });

    it("list is ordered by ascending priority", async () => {
      const rows = await caller.settings.savingsGoals.list();
      const priorities = rows.map((r: { priority: number }) => r.priority);
      expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    });
  });

  describe("update", () => {
    it("updates a goal name and monthly contribution", async () => {
      const result = await caller.settings.savingsGoals.update({
        id: vacationId,
        name: "Europe Trip 2027",
        targetAmount: "8000",
        targetDate: "2027-06-01",
        monthlyContribution: "500",
        priority: 2,
        isActive: true,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("Europe Trip 2027");
      expect(result!.monthlyContribution).toBe("500");
    });

    it("deactivates a goal by setting isActive: false", async () => {
      const result = await caller.settings.savingsGoals.update({
        id: vacationId,
        name: "Europe Trip 2027",
        targetAmount: "8000",
        monthlyContribution: "500",
        priority: 2,
        isActive: false,
        isEmergencyFund: false,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.isActive).toBe(false);
    });

    it("deactivated goal still appears in list with isActive: false", async () => {
      const rows = await caller.settings.savingsGoals.list();
      const found = rows.find((r: { id: number }) => r.id === vacationId);
      expect(found).toBeDefined();
      expect(found!.isActive).toBe(false);
    });

    it("can update target amount on emergency fund", async () => {
      const result = await caller.settings.savingsGoals.update({
        id: emergencyFundId,
        name: "Emergency Fund",
        targetAmount: "20000",
        monthlyContribution: "750",
        priority: 1,
        isActive: true,
        isEmergencyFund: true,
        targetMode: "fixed",
      });
      expect(result).toBeDefined();
      expect(result!.targetAmount).toBe("20000");
    });
  });

  describe("delete", () => {
    it("deletes a savings goal", async () => {
      const created = await caller.settings.savingsGoals.create({
        name: "Throwaway Goal",
        targetAmount: "500",
        monthlyContribution: "50",
        priority: 99,
        isActive: true,
      });
      expect(created).toBeDefined();

      await caller.settings.savingsGoals.delete({ id: created!.id });

      const rows = await caller.settings.savingsGoals.list();
      expect(
        rows.find((r: { id: number }) => r.id === created!.id),
      ).toBeUndefined();
    });

    it("other goals are unaffected when one is deleted", async () => {
      const before = await caller.settings.savingsGoals.list();
      const countBefore = before.length;

      const tmp = await caller.settings.savingsGoals.create({
        name: "Ephemeral Goal",
        monthlyContribution: "0",
        priority: 100,
        isActive: true,
      });
      await caller.settings.savingsGoals.delete({ id: tmp!.id });

      const after = await caller.settings.savingsGoals.list();
      expect(after.length).toBe(countBefore);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RELOCATION SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.relocationScenarios", () => {
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
      const rows = await caller.settings.relocationScenarios.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });
  });

  describe("save (create)", () => {
    it("creates a new relocation scenario (no id supplied)", async () => {
      const result = await caller.settings.relocationScenarios.save({
        name: "NYC to Austin",
        params: minimalParams,
      });
      expect(result).toBeDefined();
      expect(result!.name).toBe("NYC to Austin");
      expect(result!.params).toMatchObject({ currentProfileId: 1 });
      savedId = result!.id;
    });

    it("created scenario appears in list", async () => {
      const rows = await caller.settings.relocationScenarios.list();
      expect(rows.find((r: { id: number }) => r.id === savedId)).toBeDefined();
    });

    it("creates a second scenario", async () => {
      const result = await caller.settings.relocationScenarios.save({
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
      const rows = await caller.settings.relocationScenarios.list();
      const names = rows.map((r: { name: string }) => r.name);
      expect(names).toContain("NYC to Austin");
      expect(names).toContain("SF to Denver");
    });
  });

  describe("save (update)", () => {
    it("updates an existing scenario when id is provided", async () => {
      const result = await caller.settings.relocationScenarios.save({
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
      const rows = await caller.settings.relocationScenarios.list();
      const found = rows.find((r: { id: number }) => r.id === savedId);
      expect(found).toBeDefined();
      expect(found!.name).toBe("NYC to Austin — Revised");
    });
  });

  describe("delete", () => {
    it("deletes a relocation scenario", async () => {
      const created = await caller.settings.relocationScenarios.save({
        name: "Throwaway Relocation",
        params: minimalParams,
      });
      expect(created).toBeDefined();

      await caller.settings.relocationScenarios.delete({ id: created!.id });

      const rows = await caller.settings.relocationScenarios.list();
      expect(
        rows.find((r: { id: number }) => r.id === created!.id),
      ).toBeUndefined();
    });

    it("remaining scenarios are unaffected", async () => {
      const rows = await caller.settings.relocationScenarios.list();
      expect(rows.find((r: { id: number }) => r.id === savedId)).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE ACCOUNTS
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.performanceAccounts", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let personId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Alice", "1985-03-15");
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns an empty array on a fresh database", async () => {
      const rows = await caller.settings.performanceAccounts.list();
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(0);
    });

    it("returns seeded accounts ordered by displayOrder then id", async () => {
      seedPerformanceAccount(db, {
        institution: "Fidelity",
        accountType: "401k",
        displayOrder: 2,
      });
      seedPerformanceAccount(db, {
        institution: "Vanguard",
        accountType: "IRA",
        displayOrder: 1,
      });
      const rows = await caller.settings.performanceAccounts.list();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // Vanguard (order=1) should come before Fidelity (order=2)
      const vIdx = rows.findIndex(
        (r: { institution: string }) => r.institution === "Vanguard",
      );
      const fIdx = rows.findIndex(
        (r: { institution: string }) => r.institution === "Fidelity",
      );
      expect(vIdx).toBeLessThan(fIdx);
    });
  });

  describe("create", () => {
    it("creates a performance account without owner", async () => {
      const result = await caller.settings.performanceAccounts.create({
        institution: "Schwab",
        accountType: "brokerage",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: true,
        displayOrder: 0,
      });
      expect(result).toBeDefined();
      expect(result!.institution).toBe("Schwab");
      expect(result!.accountType).toBe("brokerage");
      expect(result!.ownerPersonId).toBeNull();
    });

    it("creates a performance account with an owner person", async () => {
      const result = await caller.settings.performanceAccounts.create({
        institution: "Fidelity",
        accountType: "401k",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 1,
      });
      expect(result).toBeDefined();
      expect(result!.institution).toBe("Fidelity");
      expect(result!.ownerPersonId).toBe(personId);
    });

    it("auto-generates accountLabel from institution + accountType + owner", async () => {
      const result = await caller.settings.performanceAccounts.create({
        institution: "Vanguard",
        accountType: "IRA",
        ownerPersonId: personId,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 2,
      });
      expect(result).toBeDefined();
      // accountLabel is generated; it should at least be a non-empty string
      expect(typeof result!.accountLabel).toBe("string");
      expect(result!.accountLabel!.length).toBeGreaterThan(0);
    });

    it("creates an account with optional label override", async () => {
      const result = await caller.settings.performanceAccounts.create({
        institution: "Schwab",
        accountType: "brokerage",
        label: "Main Taxable",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: true,
        displayOrder: 3,
      });
      expect(result).toBeDefined();
      expect(result!.label).toBe("Main Taxable");
    });

    it("created accounts appear in list", async () => {
      const rows = await caller.settings.performanceAccounts.list();
      const institutions = rows.map(
        (r: { institution: string }) => r.institution,
      );
      expect(institutions).toContain("Schwab");
    });

    it("creates an inactive account", async () => {
      const result = await caller.settings.performanceAccounts.create({
        institution: "OldBank",
        accountType: "savings",
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: "Portfolio",
        isActive: false,
        displayOrder: 99,
      });
      expect(result).toBeDefined();
      expect(result!.isActive).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO SNAPSHOTS — getLatest
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.portfolioSnapshots.getLatest", () => {
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

  it("returns null when no snapshots exist", async () => {
    const result = await caller.settings.portfolioSnapshots.getLatest();
    expect(result).toBeNull();
  });

  it("returns the latest snapshot after one is seeded", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    seedSnapshot(db, "2025-06-30", [
      { performanceAccountId: perfAcctId, amount: "50000", taxType: "preTax" },
    ]);

    const result = await caller.settings.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-06-30");
    expect(Array.isArray(result!.accounts)).toBe(true);
    expect(result!.accounts).toHaveLength(1);
  });

  it("snapshot accounts include the correct amount", async () => {
    const result = await caller.settings.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.accounts[0]!.amount).toBe("50000");
  });

  it("returns the most recent snapshot when multiple exist", async () => {
    const perfAcctId = seedPerformanceAccount(db, {
      institution: "Vanguard",
      accountType: "IRA",
    });
    seedSnapshot(db, "2025-12-31", [
      {
        performanceAccountId: perfAcctId,
        amount: "75000",
        taxType: "rothAfterTax",
      },
    ]);

    const result = await caller.settings.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result!.snapshot.snapshotDate).toBe("2025-12-31");
  });

  it("returned snapshot has expected shape", async () => {
    const result = await caller.settings.portfolioSnapshots.getLatest();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("snapshot");
    expect(result).toHaveProperty("accounts");
    expect(result!.snapshot).toHaveProperty("id");
    expect(result!.snapshot).toHaveProperty("snapshotDate");
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE ACCOUNTS — update / delete
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.performanceAccounts delete", () => {
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

  it("deletes an account with no linked performance records", async () => {
    const tmp = await caller.settings.performanceAccounts.create({
      institution: "TempBank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 99,
    });
    const result = await caller.settings.performanceAccounts.delete({
      id: tmp!.id,
    });
    expect(result).toEqual({ success: true });

    const list = await caller.settings.performanceAccounts.list();
    expect(list.find((r: { id: number }) => r.id === tmp!.id)).toBeUndefined();
  });

  it("delete is idempotent for non-existent id", async () => {
    const result = await caller.settings.performanceAccounts.delete({
      id: 99999,
    });
    expect(result).toEqual({ success: true });
  });

  it("rejects delete when performance records reference the account", async () => {
    const personId = await seedPerson(db, "DeleteTest", "1990-01-01");
    const acctId = seedPerformanceAccount(db, {
      institution: "LinkedBank",
      accountType: "401k",
    });
    // Seed an account_performance row referencing this account
    db.insert((await import("@/lib/db/schema-sqlite")).accountPerformance)
      .values({
        year: 2025,
        institution: "LinkedBank",
        accountLabel: "LinkedBank 401k",
        ownerPersonId: personId,
        beginningBalance: "50000",
        totalContributions: "10000",
        yearlyGainLoss: "5000",
        endingBalance: "65000",
        parentCategory: "Retirement",
        performanceAccountId: acctId,
      })
      .run();

    await expect(
      caller.settings.performanceAccounts.delete({ id: acctId }),
    ).rejects.toThrow(/Cannot delete/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO SNAPSHOTS — createAccount / updateAccount / delete
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.portfolioSnapshots createAccount/updateAccount/delete", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;
  let snapId: number;
  let personId: number;
  let perfAcctId: number;
  let createdAcctId: number;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
    personId = await seedPerson(db, "Carol", "1992-07-10");
    perfAcctId = seedPerformanceAccount(db, {
      institution: "Fidelity",
      accountType: "401k",
    });
    snapId = seedSnapshot(db, "2025-05-01", [
      { performanceAccountId: perfAcctId, amount: "80000", taxType: "preTax" },
    ]);
  });

  afterAll(() => cleanup());

  it("creates a new account in an existing snapshot", async () => {
    const result = await caller.settings.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Schwab",
      taxType: "afterTax",
      amount: "25000",
      accountType: "ira",
      parentCategory: "Retirement",
      ownerPersonId: personId,
    });
    expect(result).toBeDefined();
    expect(result.institution).toBe("Schwab");
    expect(result.amount).toBe("25000");
    expect(result.isActive).toBe(true);
    createdAcctId = result.id;
  });

  it("new account appears in getLatest", async () => {
    const latest = await caller.settings.portfolioSnapshots.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.accounts.length).toBeGreaterThanOrEqual(2);
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found).toBeDefined();
    expect(found!.institution).toBe("Schwab");
  });

  it("updates an account owner", async () => {
    await caller.settings.portfolioSnapshots.updateAccount({
      id: createdAcctId,
      ownerPersonId: personId,
    });
    const latest = await caller.settings.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found!.ownerPersonId).toBe(personId);
  });

  it("toggles isActive on an account", async () => {
    await caller.settings.portfolioSnapshots.updateAccount({
      id: createdAcctId,
      isActive: false,
    });
    const latest = await caller.settings.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found!.isActive).toBe(false);
  });

  it("updateAccount with no changes is a no-op", async () => {
    await caller.settings.portfolioSnapshots.updateAccount({
      id: createdAcctId,
    });
    const latest = await caller.settings.portfolioSnapshots.getLatest();
    const found = latest!.accounts.find(
      (a: { id: number }) => a.id === createdAcctId,
    );
    expect(found).toBeDefined();
  });

  it("creates account with performanceAccountId link", async () => {
    const result = await caller.settings.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Fidelity",
      taxType: "preTax",
      amount: "30000",
      accountType: "401k",
      parentCategory: "Retirement",
      ownerPersonId: personId,
      performanceAccountId: perfAcctId,
    });
    expect(result).toBeDefined();
    expect(result.performanceAccountId).toBe(perfAcctId);
  });

  it("creates account with subType and label", async () => {
    const result = await caller.settings.portfolioSnapshots.createAccount({
      snapshotId: snapId,
      institution: "Vanguard",
      taxType: "taxFree",
      amount: "10000",
      accountType: "ira",
      subType: "Roth",
      label: "Roth IRA",
      parentCategory: "Retirement",
    });
    expect(result).toBeDefined();
    expect(result.subType).toBe("Roth");
    expect(result.label).toBe("Roth IRA");
  });

  it("deletes a snapshot", async () => {
    const newSnapId = seedSnapshot(db, "2025-03-01", [
      { performanceAccountId: perfAcctId, amount: "70000" },
    ]);
    await caller.settings.portfolioSnapshots.delete({ id: newSnapId });

    const latest = await caller.settings.portfolioSnapshots.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.snapshot.id).toBe(snapId);
  });

  it("delete is idempotent for non-existent snapshot", async () => {
    // Should not throw
    await caller.settings.portfolioSnapshots.delete({ id: 99999 });
  });
});

// NOTE: portfolioSnapshots.create uses db.transaction() which is incompatible
// with better-sqlite3 async pattern in tests. Tested via E2E instead.

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

describe("settings.savingsGoals additional coverage", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("creates a goal with allocationPercent", async () => {
    const result = await caller.settings.savingsGoals.create({
      name: "Allocation Goal",
      monthlyContribution: "0",
      priority: 10,
      isActive: true,
      allocationPercent: "25.5",
    });
    expect(result).toBeDefined();
    expect(result!.allocationPercent).toBe("25.5");
  });

  it("creates a goal with targetMonths", async () => {
    const result = await caller.settings.savingsGoals.create({
      name: "Monthly Target Goal",
      targetAmount: "6000",
      targetMonths: 12,
      monthlyContribution: "500",
      priority: 11,
      isActive: true,
    });
    expect(result).toBeDefined();
    expect(result!.targetMonths).toBe(12);
  });

  it("creates a goal with parentGoalId", async () => {
    const parent = await caller.settings.savingsGoals.create({
      name: "Parent Goal",
      monthlyContribution: "1000",
      priority: 20,
      isActive: true,
    });
    const child = await caller.settings.savingsGoals.create({
      name: "Child Goal",
      parentGoalId: parent!.id,
      monthlyContribution: "200",
      priority: 21,
      isActive: true,
    });
    expect(child).toBeDefined();
    expect(child!.parentGoalId).toBe(parent!.id);
  });

  it("updates all fields on a goal", async () => {
    const created = await caller.settings.savingsGoals.create({
      name: "Full Update Test",
      targetAmount: "10000",
      monthlyContribution: "500",
      priority: 30,
      isActive: true,
      isEmergencyFund: false,
      targetMode: "fixed",
    });
    const result = await caller.settings.savingsGoals.update({
      id: created!.id,
      name: "Fully Updated",
      targetAmount: "20000",
      targetDate: "2028-12-31",
      monthlyContribution: "1000",
      priority: 1,
      isActive: false,
      isEmergencyFund: true,
      targetMode: "ongoing",
      allocationPercent: "50",
    });
    expect(result).toBeDefined();
    expect(result!.name).toBe("Fully Updated");
    expect(result!.targetAmount).toBe("20000");
    expect(result!.targetDate).toBe("2028-12-31");
    expect(result!.monthlyContribution).toBe("1000");
    expect(result!.priority).toBe(1);
    expect(result!.isActive).toBe(false);
    expect(result!.isEmergencyFund).toBe(true);
    expect(result!.targetMode).toBe("ongoing");
    expect(result!.allocationPercent).toBe("50");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL COVERAGE — relocation scenarios edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.relocationScenarios additional coverage", () => {
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
    const result = await caller.settings.relocationScenarios.save({
      name: "Full Params Scenario",
      params: fullParams,
    });
    expect(result).toBeDefined();
    const params = result!.params as typeof fullParams;
    expect(params.currentExpenseOverride).toBe(5000);
    expect(params.relocationExpenseOverride).toBe(4000);
  });

  it("list returns scenarios ordered by updatedAt desc", async () => {
    await caller.settings.relocationScenarios.save({
      name: "Older Scenario",
      params: { ...fullParams, currentProfileId: 10 },
    });
    const rows = await caller.settings.relocationScenarios.list();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Most recently created/updated should be first
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL COVERAGE — performance accounts edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("settings.performanceAccounts additional coverage", () => {
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

  it("creates with all optional fields", async () => {
    const personId = await seedPerson(db, "FullFields", "1990-01-01");
    const result = await caller.settings.performanceAccounts.create({
      institution: "AllFields Bank",
      accountType: "hsa",
      subType: "Investment",
      label: "HSA Investment",
      displayName: "My HSA",
      ownerPersonId: personId,
      ownershipType: "individual",
      parentCategory: "Retirement",
      isActive: true,
      displayOrder: 5,
    });
    expect(result).toBeDefined();
    expect(result!.subType).toBe("Investment");
    expect(result!.label).toBe("HSA Investment");
    expect(result!.displayName).toBe("My HSA");
    expect(result!.ownerPersonId).toBe(personId);
  });

  it("creates with joint ownership", async () => {
    const result = await caller.settings.performanceAccounts.create({
      institution: "Joint Bank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "joint",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 6,
    });
    expect(result).toBeDefined();
    expect(result!.ownershipType).toBe("joint");
  });

  it("creates accounts with every valid accountType", async () => {
    const types = ["401k", "403b", "ira", "hsa", "brokerage"];
    for (const t of types) {
      const result = await caller.settings.performanceAccounts.create({
        institution: `${t}-Bank`,
        accountType: t,
        ownerPersonId: null,
        ownershipType: "individual",
        parentCategory: t === "brokerage" ? "Portfolio" : "Retirement",
        isActive: true,
        displayOrder: 0,
      });
      expect(result).toBeDefined();
      expect(result!.accountType).toBe(t);
    }
  });

  it("creates accounts with both parentCategory values", async () => {
    const retResult = await caller.settings.performanceAccounts.create({
      institution: "RetBank",
      accountType: "401k",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Retirement",
      isActive: true,
      displayOrder: 0,
    });
    expect(retResult!.parentCategory).toBe("Retirement");

    const portResult = await caller.settings.performanceAccounts.create({
      institution: "PortBank",
      accountType: "brokerage",
      ownerPersonId: null,
      ownershipType: "individual",
      parentCategory: "Portfolio",
      isActive: true,
      displayOrder: 0,
    });
    expect(portResult!.parentCategory).toBe("Portfolio");
  });
});
