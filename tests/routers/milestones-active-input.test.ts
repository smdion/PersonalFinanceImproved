/**
 * milestones.recordReached's input (activeMilestoneInput): holdings and
 * buying months are read only for a viewer with the portfolio permission
 * (admins hold all), brokerage goals for every viewer; a failed optional
 * read becomes null with a warning (RULES § Permission & Security Gates).
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  adminSession,
  createTestCaller,
  createViewerSessionWithPermissions,
  seedJob,
  seedPerson,
  viewerSession,
} from "./setup";

const reads = vi.hoisted(() => ({
  holdings: vi.fn(),
  buyingMonths: vi.fn(),
  goals: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/server/services/investments/holdings-overview", async (orig) => ({
  ...(await orig<
    typeof import("@/server/services/investments/holdings-overview")
  >()),
  loadHoldingsOverview: reads.holdings,
}));
vi.mock("@/server/services/investments/buying-months", () => ({
  loadBuyingMonths: reads.buyingMonths,
}));
vi.mock("@/server/data/brokerage-goals", () => ({
  listBrokerageGoals: reads.goals,
}));
vi.mock("@/lib/logger", async (orig) => ({
  ...(await orig<typeof import("@/lib/logger")>()),
  log: reads.log,
}));

beforeEach(() => {
  for (const f of Object.values(reads)) f.mockReset();
  reads.holdings.mockResolvedValue(null);
  reads.buyingMonths.mockResolvedValue([]);
  reads.goals.mockResolvedValue([]);
});

async function record(session: Parameters<typeof createTestCaller>[0]) {
  const { caller, db, cleanup } = await createTestCaller(session);
  try {
    const personId = await seedPerson(db, "Test Person", "1990-01-01");
    seedJob(db, personId);
    await caller.milestones.recordReached();
  } finally {
    cleanup();
  }
}

describe("milestones.recordReached — what the input reads, by viewer", () => {
  it("a viewer without portfolio: no holdings or buying months, goals read", async () => {
    await record(viewerSession);
    expect(reads.holdings).not.toHaveBeenCalled();
    expect(reads.buyingMonths).not.toHaveBeenCalled();
    expect(reads.goals).toHaveBeenCalledTimes(1);
  });

  it("a viewer with portfolio, and an admin: all three read", async () => {
    for (const session of [
      createViewerSessionWithPermissions(["portfolio"]),
      adminSession,
    ]) {
      for (const f of [reads.holdings, reads.buyingMonths, reads.goals])
        f.mockClear();
      await record(session);
      expect(reads.holdings).toHaveBeenCalledTimes(1);
      expect(reads.buyingMonths).toHaveBeenCalledTimes(1);
      expect(reads.goals).toHaveBeenCalledTimes(1);
    }
  });

  it("a failed optional read is null with a warning, not a failed record", async () => {
    reads.holdings.mockRejectedValue(new Error("fund facts down"));
    await expect(record(adminSession)).resolves.toBeUndefined();
    expect(reads.log).toHaveBeenCalledWith(
      "warn",
      "milestones.active_input_read_failed",
      { read: "holdings", error: "fund facts down" },
    );
  });
});
