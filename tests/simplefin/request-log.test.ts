/** SimpleFIN quota ledger and request window. */
import "../helpers/setup-mocks";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { randomBytes } from "node:crypto";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";

const replay = { on: false };
vi.mock("@/lib/simplefin/client", () => ({
  getAccounts: vi.fn(),
  isSimplefinReplayMode: () => replay.on,
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
  runSimplefinSync,
  saveSimplefinConnection,
  transactionWindowStart,
} from "@/lib/simplefin/sync";
import {
  SIMPLEFIN_DAILY_REQUEST_LIMIT,
  countSimplefinRequestsLastDay,
  recordSimplefinRequest,
} from "@/lib/simplefin/request-log";

const mockGetAccounts = vi.mocked(getAccounts);
const emptyResponse = {
  accounts: [],
  providerErrors: [],
  accountIdsWithErrors: [],
};

describe("SimpleFIN request ledger", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
    await saveSimplefinConnection(
      ctx.rawDb,
      "https://u:p@bridge.simplefin.org",
    );
  });
  afterAll(() => ctx.cleanup());
  beforeEach(() => {
    mockGetAccounts.mockReset();
    replay.on = false;
    ctx.db.delete(ctx.schema.syncRequestLog).run();
  });

  it("records every real request", async () => {
    mockGetAccounts.mockResolvedValueOnce(emptyResponse);
    await runSimplefinSync(ctx.rawDb);
    expect(await countSimplefinRequestsLastDay(ctx.rawDb)).toBe(1);
  });

  it("pauses at the daily limit instead of calling SimpleFIN", async () => {
    for (let i = 0; i < SIMPLEFIN_DAILY_REQUEST_LIMIT; i++) {
      await recordSimplefinRequest(ctx.rawDb, {
        endpoint: "/accounts",
        outcome: "ok",
      });
    }
    await expect(runSimplefinSync(ctx.rawDb)).rejects.toThrow(/Paused/);
    expect(mockGetAccounts).not.toHaveBeenCalled();
  });

  it("records a failed request too (it still used quota)", async () => {
    mockGetAccounts.mockRejectedValueOnce(new Error("network down"));
    await expect(runSimplefinSync(ctx.rawDb)).rejects.toThrow();
    expect(await countSimplefinRequestsLastDay(ctx.rawDb)).toBe(1);
  });

  it("does not count replayed reads", async () => {
    replay.on = true;
    mockGetAccounts.mockResolvedValueOnce(emptyResponse);
    await runSimplefinSync(ctx.rawDb);
    expect(await countSimplefinRequestsLastDay(ctx.rawDb)).toBe(0);
  });

  it("ignores requests older than 24 hours", async () => {
    await recordSimplefinRequest(ctx.rawDb, {
      endpoint: "/accounts",
      outcome: "ok",
      at: new Date(Date.now() - 25 * 3600_000),
    });
    expect(await countSimplefinRequestsLastDay(ctx.rawDb)).toBe(0);
  });
});

describe("transactionWindowStart", () => {
  const now = new Date("2026-06-30T12:00:00Z");
  it("asks for 89 days on the first sync — a day inside SimpleFIN's 90-day limit", () => {
    expect(transactionWindowStart(null, now)).toEqual(
      new Date("2026-04-02T12:00:00Z"),
    );
  });
  it("overlaps the last successful sync by 5 days", () => {
    expect(
      transactionWindowStart(new Date("2026-06-29T12:00:00Z"), now),
    ).toEqual(new Date("2026-06-24T12:00:00Z"));
  });
  it("never reaches further back than the limit", () => {
    expect(
      transactionWindowStart(new Date("2026-01-01T00:00:00Z"), now),
    ).toEqual(new Date("2026-04-02T12:00:00Z"));
    expect(
      transactionWindowStart(new Date("2026-01-01T00:00:00Z"), now, 30),
    ).toEqual(new Date("2026-05-31T12:00:00Z"));
  });
});
