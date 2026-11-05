/**
 * pushSnapshotIfConfigured's `error` (shown after a net-worth save) is what
 * the user is told: the service sentence and what the push changed.
 */
import "../../../helpers/setup-mocks";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as budgetApi from "@/lib/budget-api";
import {
  BudgetApiError,
  WriteStopped,
  nothingChanged,
} from "@/lib/budget-api/errors";

const push = vi.hoisted((): { fails: unknown } => ({ fails: null }));
vi.mock("@/server/helpers", () => ({
  pushSnapshotToBudgetApi: vi.fn(async () => {
    throw push.fails;
  }),
}));

import { pushSnapshotIfConfigured } from "@/server/services/net-worth/snapshot-derivatives";
import type { DbOrTx } from "@/lib/db";

// setup-mocks owns the budget-api mock; this file sets what it needs.
beforeEach(() => {
  vi.mocked(budgetApi.getActiveBudgetApi).mockResolvedValue("ynab");
  vi.spyOn(budgetApi, "getApiConnection").mockResolvedValue({
    accountMappings: [{ localName: "Checking", remoteAccountId: "r1" }],
  } as never);
  vi.spyOn(budgetApi, "getClientForService").mockResolvedValue({} as never);
});

const run = () =>
  pushSnapshotIfConfigured({} as DbOrTx, {
    snapshotId: 1,
    snapshotDate: "2026-10-31",
    mode: "create",
    asOfDate: new Date("2026-10-31T12:00:00Z"),
  });

const badAnswer = () => {
  const e = new BudgetApiError("YNAB: /accounts: raw", "bad-response", null);
  e.service = "YNAB";
  e.field = "data.accounts";
  return e;
};

describe("pushSnapshotIfConfigured's error", () => {
  it("a push that failed before writing says nothing was changed", async () => {
    push.fails = nothingChanged(badAnswer());
    expect(await run()).toEqual({
      pushed: false,
      accountsPushed: 0,
      error:
        "YNAB sent something Ledgr doesn't understand (data.accounts). Nothing was changed.",
    });
  });

  it("a push that stopped partway says what it had done", async () => {
    push.fails = new WriteStopped("stopped", "Posted 1 of 2.", badAnswer());
    expect((await run()).error).toBe(
      "YNAB sent something Ledgr doesn't understand (data.accounts). Posted 1 of 2.",
    );
  });

  it("a failure with no service behind it keeps its own message", async () => {
    push.fails = new Error("disk full");
    expect((await run()).error).toBe("disk full");
  });
});
