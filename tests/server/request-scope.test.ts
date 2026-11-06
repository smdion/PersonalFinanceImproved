/**
 * RequestScope: RULES § Time Resolution ("now" is resolved once and
 * passed through; today is the household's day). Every procedure call
 * gets its own scope, built after the demo-schema switch, so one caller
 * reused across two dates (tests/baseline/sync-writes.test.ts) sees each.
 * `scope.load` shares a read across one request's query calls: never
 * across db objects, never into a mutation, never past a write.
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
import { asc, eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import {
  createCallerFactory,
  createTRPCRouter,
  internalCtx,
  publicProcedure,
} from "@/server/trpc";
import {
  createReadMemo,
  createRequestScope,
  invalidateRequestReads,
} from "@/server/data/request-scope";
import { getAllPeople } from "@/server/data/people";
import { appRouter } from "@/server/routers";
import {
  adminSession,
  createTestCaller,
  createViewerSessionWithPermissions,
  seedPerson,
  viewerSession,
} from "../routers/setup";

/** The household's names, through `scope.load`. */
const namesRouter = createTRPCRouter({
  names: publicProcedure.query(async ({ ctx }) =>
    (await ctx.scope.load(getAllPeople)).map((p) => p.name),
  ),
});

const probeRouter = createTRPCRouter({
  names: namesRouter.names,
  scope: publicProcedure.query(({ ctx }) => ({
    asOf: ctx.scope.asOf.toISOString(),
    today: ctx.scope.today,
    sameDb: ctx.scope.db === ctx.db,
  })),
  can: publicProcedure.query(({ ctx }) => ({
    portfolio: ctx.scope.can("portfolio"),
    brokerage: ctx.scope.can("brokerage"),
  })),
  /** Reads, writes a person, reads again: through nested query calls. */
  readWriteRead: publicProcedure.mutation(async ({ ctx }) => {
    const nested = createCallerFactory(namesRouter)(internalCtx(ctx));
    const before = await nested.names();
    await ctx.db
      .insert(schema.people)
      .values({ name: "Written", dateOfBirth: "1991-02-03" });
    return { before, after: await nested.names() };
  }),
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
    const scope = createRequestScope(harness.rawDb, asOf, undefined);
    expect(scope.today).toBe("2025-12-31");
  });

  it("asks the viewer: admins hold every permission, a viewer only theirs, no session none", async () => {
    const can = (session: typeof adminSession | null) =>
      createCallerFactory(probeRouter)({
        db: harness.rawDb,
        session,
        demoSchema: null,
      }).can();
    expect(await can(adminSession)).toEqual({
      portfolio: true,
      brokerage: true,
    });
    expect(
      await can(createViewerSessionWithPermissions(["portfolio"])),
    ).toEqual({ portfolio: true, brokerage: false });
    expect(await can(viewerSession)).toEqual({
      portfolio: false,
      brokerage: false,
    });
    expect(await can(null)).toEqual({ portfolio: false, brokerage: false });
  });

  describe("load", () => {
    /** A loader that counts its reads (keyed by identity: one per test). */
    function countingPeople() {
      let reads = 0;
      const read = (db: DbOrTx) => {
        reads++;
        return getAllPeople(db);
      };
      return { read, reads: () => reads };
    }

    it("reads directly without a memo, every call", async () => {
      const scope = createRequestScope(harness.rawDb, new Date(), undefined);
      const people = countingPeople();
      await scope.load(people.read);
      await scope.load(people.read);
      expect(people.reads()).toBe(2);
    });

    it("shares one read across a request's scopes on one db, [] included", async () => {
      const t = await createTestCaller();
      try {
        const memo = createReadMemo({ freeze: true });
        const people = countingPeople();
        const a = createRequestScope(t.rawDb, new Date(), undefined, memo);
        const b = createRequestScope(t.rawDb, new Date(), undefined, memo);
        const [first, second] = await Promise.all([
          a.load(people.read),
          b.load(people.read),
        ]);
        expect(first).toEqual([]);
        expect(second).toBe(first);
        expect(people.reads()).toBe(1);
        expect(Object.isFrozen(first)).toBe(true);
      } finally {
        t.cleanup();
      }
    });

    it("never shares across db objects (a demo call's db, another install)", async () => {
      const other = await createTestCaller();
      try {
        seedPerson(other.db, "Other");
        const memo = createReadMemo();
        const mine = createRequestScope(
          harness.rawDb,
          new Date(),
          undefined,
          memo,
        );
        const theirs = createRequestScope(
          other.rawDb,
          new Date(),
          undefined,
          memo,
        );
        const [a, b] = await Promise.all([
          mine.load(getAllPeople),
          theirs.load(getAllPeople),
        ]);
        expect(b.map((p) => p.name)).toEqual(["Other"]);
        expect(a).toEqual(await getAllPeople(harness.rawDb));
      } finally {
        other.cleanup();
      }
    });

    it("a transaction reads its own writes, and its reads stay in it", async () => {
      const t = await createTestCaller();
      try {
        seedPerson(t.db, "Before");
        const memo = createReadMemo();
        const outer = createRequestScope(t.rawDb, new Date(), undefined, memo);
        expect((await outer.load(getAllPeople)).map((p) => p.name)).toEqual([
          "Before",
        ]);
        const inside = await t.rawDb.transaction(async (tx) => {
          await tx
            .insert(schema.people)
            .values({ name: "In tx", dateOfBirth: "1992-04-05" });
          const scope = createRequestScope(tx, new Date(), undefined, memo);
          return (await scope.load(getAllPeople)).map((p) => p.name);
        });
        expect(inside).toEqual(["Before", "In tx"]);
        // The outer entry was never replaced by the transaction's read.
        expect((await outer.load(getAllPeople)).map((p) => p.name)).toEqual([
          "Before",
        ]);
      } finally {
        t.cleanup();
      }
    });

    it("drops every entry at a mutation, and a read started before it", async () => {
      const memo = createReadMemo();
      const scope = createRequestScope(
        harness.rawDb,
        new Date(),
        undefined,
        memo,
      );
      const people = countingPeople();
      const pending = scope.load(people.read);
      invalidateRequestReads();
      await pending;
      await scope.load(people.read);
      expect(people.reads()).toBe(2);
      await scope.load(people.read);
      expect(people.reads()).toBe(2);
    });

    it("evicts a failed read", async () => {
      const memo = createReadMemo();
      const scope = createRequestScope(
        harness.rawDb,
        new Date(),
        undefined,
        memo,
      );
      let calls = 0;
      const flaky = async (db: DbOrTx) => {
        if (++calls === 1) throw new Error("read failed");
        return getAllPeople(db);
      };
      await expect(scope.load(flaky)).rejects.toThrow("read failed");
      await expect(scope.load(flaky)).resolves.toEqual(
        await getAllPeople(harness.rawDb),
      );
      expect(calls).toBe(2);
    });

    it("returns the direct query's rows in its order, every time, after an update too", async () => {
      const t = await createTestCaller();
      try {
        for (const name of ["Cy", "Ann", "Bo"]) seedPerson(t.db, name);
        const direct = () =>
          t.rawDb.select().from(schema.people).orderBy(asc(schema.people.id));
        for (let round = 0; round < 3; round++) {
          const scope = createRequestScope(
            t.rawDb,
            new Date(),
            undefined,
            createReadMemo(),
          );
          expect(await scope.load(getAllPeople)).toEqual(await direct());
          await t.rawDb
            .update(schema.people)
            .set({ name: `Ann ${round}` })
            .where(
              eq(schema.people.name, round === 0 ? "Ann" : `Ann ${round - 1}`),
            );
        }
      } finally {
        t.cleanup();
      }
    });

    it("a read, a mutation, a read in one request: the second read is new", async () => {
      const t = await createTestCaller();
      try {
        const ctx = {
          db: t.rawDb,
          session: adminSession,
          demoSchema: null,
          reads: createReadMemo({ freeze: true }),
        };
        const app = createCallerFactory(appRouter)(ctx);
        const probe = createCallerFactory(probeRouter)(ctx);
        expect(await probe.names()).toEqual([]);
        await app.settings.people.create({
          name: "New",
          dateOfBirth: "1990-01-02",
          isPrimaryUser: true,
        });
        expect(await probe.names()).toEqual(["New"]);
        const paycheck = await app.paycheck.computeSummary();
        expect(paycheck.people.map((p) => p.person.name)).toEqual(["New"]);
      } finally {
        t.cleanup();
      }
    });

    it("a mutation's nested query calls read directly, so they see its write", async () => {
      const t = await createTestCaller();
      try {
        const probe = createCallerFactory(probeRouter)({
          db: t.rawDb,
          session: adminSession,
          demoSchema: null,
          reads: createReadMemo(),
        });
        expect(await probe.readWriteRead()).toEqual({
          before: [],
          after: ["Written"],
        });
      } finally {
        t.cleanup();
      }
    });

    it("keeps each call's own asOf under one memo", async () => {
      const caller = createCallerFactory(probeRouter)({
        db: harness.rawDb,
        session: null,
        demoSchema: null,
        reads: createReadMemo(),
      });
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
      const first = await caller.scope();
      vi.setSystemTime(new Date("2026-03-02T12:00:00Z"));
      const second = await caller.scope();
      expect(first.today).toBe("2026-03-01");
      expect(second.today).toBe("2026-03-02");
    });
  });
});
