/**
 * Which transactions a sync asks SimpleFIN for. The window follows the last
 * complete investment ingest, not the balance sync — so the first sync
 * after upgrading reaches back the full 90 days even though balances have
 * synced daily for months.
 */
import "../helpers/setup-mocks";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";

vi.mock("@/lib/simplefin/client", () => ({
  getAccounts: vi.fn(),
  isSimplefinReplayMode: () => true, // quota ledger out of the way
}));

const TEST_ENCRYPTION_KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

import { getAccounts } from "@/lib/simplefin/client";
import {
  getInvestmentsSyncedAt,
  getWindowLimitDays,
  runSimplefinSync,
  saveSimplefinConnection,
} from "@/lib/simplefin/sync";

const mockGetAccounts = vi.mocked(getAccounts);
const DAY = 86_400_000;

const response = (accountIdsWithErrors: string[] = []) => ({
  accounts: [
    {
      id: "acct-1",
      name: "Example Checking",
      balance: 100,
      orgName: "Example Bank",
      balanceDate: null,
      holdings: null,
      transactions: [],
    },
  ],
  providerErrors: [],
  accountIdsWithErrors,
});

const requestedStart = () =>
  (mockGetAccounts.mock.calls.at(-1)![1] as { startDate: Date }).startDate;

describe("transaction window across syncs", () => {
  let ctx: TestDbContext;
  beforeAll(async () => {
    ctx = await createTestDb();
    await saveSimplefinConnection(ctx.rawDb, "https://u:p@bridge.example");
    // Balances have been syncing daily before this version.
    await ctx.rawDb
      .update(ctx.appSchema.apiConnections)
      .set({ lastSyncedAt: new Date("2026-06-01T12:00:00Z") })
      .where(eq(ctx.schema.apiConnections.service, "simplefin"));
  });
  afterAll(() => ctx.cleanup());

  it("asks for the full window on the first sync after upgrading", async () => {
    const asOf = new Date("2026-06-02T12:00:00Z");
    mockGetAccounts.mockResolvedValueOnce(response());
    await runSimplefinSync(ctx.rawDb, asOf);
    expect(requestedStart()).toEqual(new Date(asOf.getTime() - 89 * DAY));
    expect(await getInvestmentsSyncedAt(ctx.rawDb)).toEqual(asOf);
  });

  it("then overlaps the last complete ingest by 5 days", async () => {
    mockGetAccounts.mockResolvedValueOnce(response());
    await runSimplefinSync(ctx.rawDb, new Date("2026-06-03T12:00:00Z"));
    expect(requestedStart()).toEqual(new Date("2026-05-28T12:00:00Z"));
  });

  it("doesn't move the window forward when an account reported an error", async () => {
    mockGetAccounts.mockResolvedValueOnce(response(["acct-1"]));
    await runSimplefinSync(ctx.rawDb, new Date("2026-06-04T12:00:00Z"));
    expect(await getInvestmentsSyncedAt(ctx.rawDb)).toEqual(
      new Date("2026-06-03T12:00:00Z"),
    );
    mockGetAccounts.mockResolvedValueOnce(response());
    await runSimplefinSync(ctx.rawDb, new Date("2026-06-05T12:00:00Z"));
    expect(requestedStart()).toEqual(new Date("2026-05-29T12:00:00Z")); // still from Jun 3
  });

  it("reports a 'capped' notice as information, not an error, and learns the limit", async () => {
    const capped = {
      ...response(),
      notices: [
        "Requested date range exceeds limit of 60 days and was capped.",
      ],
      windowLimitDays: 60,
    };
    mockGetAccounts.mockResolvedValueOnce(capped);
    const r = await runSimplefinSync(
      ctx.rawDb,
      new Date("2026-06-06T12:00:00Z"),
    );
    expect(r.providerErrors).toEqual([]);
    expect(await getWindowLimitDays(ctx.rawDb)).toBe(59);
    // The next request stays inside the learned limit.
    await ctx.rawDb
      .delete(ctx.appSchema.appSettings)
      .where(eq(ctx.schema.appSettings.key, "simplefin_investments_synced_at"));
    mockGetAccounts.mockResolvedValueOnce(response());
    const asOf = new Date("2026-06-07T12:00:00Z");
    await runSimplefinSync(ctx.rawDb, asOf);
    expect(requestedStart()).toEqual(new Date(asOf.getTime() - 59 * DAY));
  });
});
