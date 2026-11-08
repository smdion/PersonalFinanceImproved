/**
 * Who may use the Integrations page's procedures: the page is admin-only, and
 * so is everything only it calls. A `sync`-only viewer keeps every sync run
 * from elsewhere (the header, onboarding, the portfolio page) and SEC's refresh.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { createTestCaller, createViewerSessionWithPermissions } from "./setup";

type Caller = Awaited<ReturnType<typeof createTestCaller>>["caller"];
type Call = (caller: Caller) => Promise<unknown>;

// A value no procedure's input accepts: a gated call is refused before its
// input is read, a passed one stops at the input (BAD_REQUEST) and writes
// nothing. Procedures without input run on an empty database (no network).
const BAD = "not-an-input" as never;

const ADMIN_ONLY: Record<string, Call> = {
  "simplefin.saveToken": (c) => c.simplefin.saveToken(BAD),
  "simplefin.testConnection": (c) => c.simplefin.testConnection(),
  "simplefin.removeConnection": (c) => c.simplefin.removeConnection(),
  "simplefin.setAccountIncluded": (c) => c.simplefin.setAccountIncluded(BAD),
  "simplefin.mergeReaddedAccount": (c) => c.simplefin.mergeReaddedAccount(BAD),
  "simplefin.acceptLinkSuggestions": (c) =>
    c.simplefin.acceptLinkSuggestions(BAD),
  "simplefin.setAccountMapping": (c) => c.simplefin.setAccountMapping(BAD),
  "simplefin.setLoanLink": (c) => c.simplefin.setLoanLink(BAD),
  "sync.setActiveBudgetApi": (c) => c.sync.setActiveBudgetApi(BAD),
  "sync.setLinkedProfile": (c) => c.sync.setLinkedProfile(BAD),
  "sync.setLinkedColumn": (c) => c.sync.setLinkedColumn(BAD),
  "sync.skipCategory": (c) => c.sync.skipCategory(BAD),
  "sync.unskipCategory": (c) => c.sync.unskipCategory(BAD),
  "sync.updateAccountMappings": (c) => c.sync.updateAccountMappings(BAD),
  "sync.createAssetAndMap": (c) => c.sync.createAssetAndMap(BAD),
  "sync.renameBudgetItemToApi": (c) => c.sync.renameBudgetItemToApi(BAD),
  "sync.renameBudgetItemApiName": (c) => c.sync.renameBudgetItemApiName(BAD),
  "sync.moveBudgetItemToApiGroup": (c) => c.sync.moveBudgetItemToApiGroup(BAD),
  "sync.renameSavingsGoalToApi": (c) => c.sync.renameSavingsGoalToApi(BAD),
  "sync.renameSavingsGoalApiName": (c) => c.sync.renameSavingsGoalApiName(BAD),
  "sync.syncAllNames": (c) => c.sync.syncAllNames(BAD),
  "tiingo.saveKey": (c) => c.tiingo.saveKey(BAD),
  "tiingo.testConnection": (c) => c.tiingo.testConnection(),
  "tiingo.removeConnection": (c) => c.tiingo.removeConnection(),
  "sec.saveContact": (c) => c.sec.saveContact(BAD),
  "sec.testConnection": (c) => c.sec.testConnection(),
  "sec.removeConnection": (c) => c.sec.removeConnection(),
};

const STILL_SYNC: Record<string, Call> = {
  "sync.syncAll": (c) => c.sync.syncAll(BAD),
  "sync.resyncPortfolioPush": (c) => c.sync.resyncPortfolioPush(BAD),
  "simplefin.syncNow": (c) => c.simplefin.syncNow(),
  "sec.refreshNow": (c) => c.sec.refreshNow(),
};

/** The call's error code, or "ok" when it resolved. */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "ok";
  } catch (e) {
    return e instanceof TRPCError ? e.code : String(e);
  }
}

async function outcomes(
  session: Parameters<typeof createTestCaller>[0],
  calls: Record<string, Call>,
): Promise<Record<string, string>> {
  const { caller, cleanup } = await createTestCaller(session);
  try {
    const out: Record<string, string> = {};
    for (const [path, call] of Object.entries(calls))
      out[path] = await outcome(call(caller));
    return out;
  } finally {
    cleanup();
  }
}

const passedGate = (code: string) =>
  code !== "FORBIDDEN" && code !== "UNAUTHORIZED";

describe("Integrations procedures", () => {
  it("are admin procedures, and the syncs run elsewhere stay on sync", async () => {
    const { appRouter } = await import("@/server/routers");
    const procedures: Record<string, unknown> = appRouter._def.procedures;
    const auth = (path: string) =>
      (procedures[path] as { _def: { meta?: { auth?: string } } })._def.meta
        ?.auth;
    for (const path of Object.keys(ADMIN_ONLY))
      expect([path, auth(path)]).toEqual([path, "admin"]);
    for (const path of Object.keys(STILL_SYNC))
      expect([path, auth(path)]).toEqual([path, "sync"]);
  });

  it("refuse a sync-only viewer", async () => {
    const got = await outcomes(
      createViewerSessionWithPermissions(["sync"]),
      ADMIN_ONLY,
    );
    for (const [path, code] of Object.entries(got))
      expect([path, code]).toEqual([path, "FORBIDDEN"]);
  });

  it("let an admin through", async () => {
    const got = await outcomes(undefined, ADMIN_ONLY);
    for (const [path, code] of Object.entries(got))
      expect([path, passedGate(code), code]).toEqual([path, true, code]);
  });

  it("leave a sync-only viewer every sync they had", async () => {
    const got = await outcomes(
      createViewerSessionWithPermissions(["sync"]),
      STILL_SYNC,
    );
    for (const [path, code] of Object.entries(got))
      expect([path, passedGate(code), code]).toEqual([path, true, code]);
  });

  it("refuse the syncs to a viewer without sync", async () => {
    const got = await outcomes(
      createViewerSessionWithPermissions(["budget"]),
      STILL_SYNC,
    );
    for (const [path, code] of Object.entries(got))
      expect([path, code]).toEqual([path, "FORBIDDEN"]);
  });
});
