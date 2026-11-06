/**
 * contribution.computeSummary reads live contribution actuals (Performance
 * plus what SimpleFIN has seen since) only for a viewer who holds the
 * portfolio permission (admins hold all), through ctx.scope.can.
 */
import "./setup-mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminSession,
  createTestCaller,
  createViewerSessionWithPermissions,
  viewerSession,
} from "./setup";
import type { Session } from "next-auth";

const { loadLive } = vi.hoisted(() => ({
  loadLive: vi.fn(async () => []),
}));
vi.mock("@/server/services/investments/live-contributions", async (orig) => ({
  ...(await orig<
    typeof import("@/server/services/investments/live-contributions")
  >()),
  loadLiveContributions: loadLive,
}));

describe("contribution.computeSummary live actuals by permission", () => {
  afterEach(() => loadLive.mockClear());

  const run = async (session: Session) => {
    const { caller, cleanup } = await createTestCaller(session);
    try {
      await caller.contribution.computeSummary();
    } finally {
      cleanup();
    }
  };

  it("reads them for an admin", async () => {
    await run(adminSession);
    expect(loadLive).toHaveBeenCalledTimes(1);
  });

  it("reads them for a viewer with portfolio", async () => {
    await run(createViewerSessionWithPermissions(["portfolio"]));
    expect(loadLive).toHaveBeenCalledTimes(1);
  });

  it("skips them for a viewer without portfolio", async () => {
    await run(viewerSession);
    await run(createViewerSessionWithPermissions(["brokerage"]));
    expect(loadLive).not.toHaveBeenCalled();
  });
});
