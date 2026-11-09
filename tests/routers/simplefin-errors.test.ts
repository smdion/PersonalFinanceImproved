/**
 * What the SimpleFIN router tells a user when SimpleFIN fails: the sync
 * keeps the service error as its cause and says nothing was changed; the
 * connection test words the failure without claiming anything.
 */
import "./setup-mocks";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { serviceError, userMessageFor } from "@/lib/budget-api/errors";
import { createTestCaller } from "./setup";
import * as sqliteSchema from "@/lib/db/schema-sqlite";

vi.mock("@/lib/simplefin/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/simplefin/client")>()),
  getAccounts: vi.fn(),
  claimSetupToken: vi.fn(),
  isSimplefinReplayMode: () => false,
}));

import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";
import {
  getSimplefinConnection,
  removeSimplefinConnection,
  saveSimplefinConnection,
} from "@/server/services/sync/simplefin/sync";

const mockGetAccounts = vi.mocked(getAccounts);
const badResponse = () => {
  const e = serviceError(
    "SimpleFIN",
    "SimpleFIN: /accounts: errors: expected array",
    "bad-response",
  );
  e.field = "errors";
  return e;
};

let t: Awaited<ReturnType<typeof createTestCaller>>;
beforeEach(async () => {
  t = await createTestCaller();
  await saveSimplefinConnection(t.rawDb, "https://u:p@bridge.simplefin.org");
  mockGetAccounts.mockReset();
});
afterEach(() => t.cleanup());

describe("simplefin.syncNow when SimpleFIN answers badly", () => {
  it("keeps the cause, says nothing was changed, and changes nothing", async () => {
    const before = t.db.select().from(sqliteSchema.simplefinAccounts).all();
    mockGetAccounts.mockRejectedValueOnce(badResponse());

    const error = await t.caller.simplefin.syncNow().then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TRPCError);
    expect(userMessageFor(error)).toBe(
      "SimpleFIN sent something Ledgr doesn't understand (errors). Nothing was changed.",
    );
    expect(t.db.select().from(sqliteSchema.simplefinAccounts).all()).toEqual(
      before,
    );
    expect(
      t.db.select().from(sqliteSchema.simplefinBalanceSnapshots).all(),
    ).toEqual([]);
    const status = await t.caller.simplefin.getStatus();
    expect(status.lastError).toBe(userMessageFor(error));
  });

  it("a failure that isn't SimpleFIN's keeps its own words", async () => {
    mockGetAccounts.mockRejectedValueOnce(new Error("disk full"));
    const error = await t.caller.simplefin.syncNow().then(
      () => null,
      (e: unknown) => e,
    );
    expect(userMessageFor(error)).toBeNull();
    expect((error as TRPCError).message).toBe(
      "SimpleFIN sync failed: disk full",
    );
  });
});

describe("simplefin.testConnection when SimpleFIN answers badly", () => {
  it("says what SimpleFIN sent, claiming nothing", async () => {
    mockGetAccounts.mockRejectedValueOnce(badResponse());
    expect(await t.caller.simplefin.testConnection()).toEqual({
      ok: false,
      error: "SimpleFIN sent something Ledgr doesn't understand (errors).",
    });
  });
});

describe("simplefin.saveToken when SimpleFIN refuses the claim", () => {
  it("says so, keeps the cause, and stores nothing", async () => {
    await removeSimplefinConnection(t.rawDb);
    vi.mocked(claimSetupToken).mockRejectedValueOnce(
      serviceError("SimpleFIN", "Client error (403): token used", "client"),
    );
    const error = await t.caller.simplefin
      .saveToken({ setupToken: "dG9rZW4=" })
      .then(
        () => null,
        (e: unknown) => e,
      );
    const said = "SimpleFIN refused Ledgr's request. Nothing was changed.";
    expect((error as TRPCError).message).toBe(said);
    expect(userMessageFor(error)).toBe(said);
    expect(await getSimplefinConnection(t.rawDb)).toBeNull();
  });
});
