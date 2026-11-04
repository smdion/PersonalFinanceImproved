/**
 * RequestScope: RULES § Time Resolution ("now" is resolved once and
 * passed through; today is the household's day). Every procedure call
 * gets its own scope, built after the demo-schema switch, so one caller
 * reused across two dates (tests/baseline/sync-writes.test.ts) sees each.
 */
import "../routers/setup-mocks";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createCallerFactory,
  createTRPCRouter,
  publicProcedure,
} from "@/server/trpc";
import { createRequestScope } from "@/server/data/request-scope";
import { createTestCaller } from "../routers/setup";

const probeRouter = createTRPCRouter({
  scope: publicProcedure.query(({ ctx }) => ({
    asOf: ctx.scope.asOf.toISOString(),
    today: ctx.scope.today,
    sameDb: ctx.scope.db === ctx.db,
  })),
});

describe("RequestScope", () => {
  const zone = process.env.TZ;
  let harness: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    harness = await createTestCaller();
  });
  afterAll(() => harness.cleanup());
  afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it("is built per call: one caller, two dates, two scopes", async () => {
    const caller = createCallerFactory(probeRouter)({
      db: harness.rawDb,
      session: null,
      demoSchema: null,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    const first = await caller.scope();
    vi.setSystemTime(new Date("2026-03-02T12:00:00Z"));
    const second = await caller.scope();

    expect(first).toEqual({
      asOf: "2026-03-01T12:00:00.000Z",
      today: "2026-03-01",
      sameDb: true,
    });
    expect(second.asOf).toBe("2026-03-02T12:00:00.000Z");
    expect(second.today).toBe("2026-03-02");
  });

  it("dates today in the household time zone, not UTC", () => {
    process.env.TZ = "America/Chicago";
    const asOf = new Date("2026-01-01T03:00:00Z");
    const scope = createRequestScope(harness.rawDb, asOf);
    expect(scope.today).toBe("2025-12-31");
  });
});
