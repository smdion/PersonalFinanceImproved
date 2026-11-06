/**
 * budget.computeActiveSummary when its paycheck summary fails: the
 * What-If tab's income figure is supplementary, so netMonthlyIncome comes
 * back null, a warning is logged and the budget items still return.
 */
import "./setup-mocks";
import { vi, describe, it, expect } from "vitest";
import { createTestCaller, seedStandardDataset, adminSession } from "./setup";

const { logSpy } = vi.hoisted(() => ({ logSpy: vi.fn() }));

vi.mock("@/server/services/paycheck/summary", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/services/paycheck/summary")
  >()),
  computePaycheckSummary: vi.fn().mockRejectedValue(new Error("bad row")),
}));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  log: logSpy,
}));

describe("budget.computeActiveSummary — paycheck summary fails", () => {
  it("returns the items with a null netMonthlyIncome and logs a warning", async () => {
    const { caller, db, cleanup } = await createTestCaller(adminSession);
    try {
      seedStandardDataset(db);
      const summary = await caller.budget.computeActiveSummary();
      expect(summary.netMonthlyIncome).toBeNull();
      expect(summary.rawItems?.length).toBeGreaterThan(0);
      expect(logSpy).toHaveBeenCalledWith(
        "warn",
        "computeActiveSummary.netMonthlyIncome_failed",
        { error: "bad row" },
      );
    } finally {
      cleanup();
    }
  });
});
