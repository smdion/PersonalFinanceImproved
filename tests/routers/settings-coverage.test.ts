/**
 * Coverage tests for src/server/routers/settings.ts
 *
 * The file is a barrel re-export: `export { settingsRouter } from "./settings/index"`.
 * This test verifies the barrel import works and the merged router has expected sub-routers.
 */
import "./setup-mocks";
import { vi, describe, it, expect, afterAll, beforeAll } from "vitest";
import { createTestCaller, adminSession } from "./setup";

vi.mock("@/lib/budget-api", () => ({
  getActiveBudgetApi: vi.fn().mockResolvedValue("none"),
  getBudgetAPIClient: vi.fn().mockResolvedValue(null),
  cacheGet: vi.fn().mockResolvedValue(null),
  getClientForService: vi.fn().mockResolvedValue(null),
}));

describe("settings router barrel export", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller(adminSession);
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  it("exposes appSettings sub-router", async () => {
    const result = await caller.settings.appSettings.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("exposes scenarios sub-router", async () => {
    const result = await caller.settings.scenarios.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("exposes savingsGoals sub-router", async () => {
    const result = await caller.settings.savingsGoals.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("exposes performanceAccounts sub-router", async () => {
    const result = await caller.settings.performanceAccounts.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("exposes portfolioSnapshots sub-router", async () => {
    const result = await caller.settings.portfolioSnapshots.getLatest();
    // Fresh DB — no snapshots
    expect(result).toBeNull();
  });

  it("exposes getDataFreshness procedure", async () => {
    const result = await caller.settings.getDataFreshness();
    expect(result).toHaveProperty("balanceDate");
    expect(result).toHaveProperty("performanceDate");
  });

  it("exposes rbacGroups sub-router", async () => {
    const result = await caller.settings.rbacGroups.get();
    expect(result).toHaveProperty("adminGroup");
    expect(result).toHaveProperty("permissions");
  });

  it("exposes relocationScenarios sub-router", async () => {
    const result = await caller.settings.relocationScenarios.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("exposes apiConnections sub-router", async () => {
    const result = await caller.settings.apiConnections.list();
    expect(Array.isArray(result)).toBe(true);
  });
});
