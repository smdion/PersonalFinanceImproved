/**
 * One request, one year (RULES § Time Resolution): every query reads its
 * date from the request scope, so a clock that turns over to the next year
 * while the request runs changes nothing it returns. Each query is called
 * twice on its own copy of the household, the scope made at 23:59:59.999
 * on Dec 31: once with the clock held there, once with the clock moved to
 * Jan 1 right after the scope is made. A query that reads the clock itself
 * sees the new year in the second call. The write paths that judge by the
 * year (the save-time IRS-limit judge, the prior-year amount's year) get
 * the same turn: each write's answer and the rows it leaves must match.
 */
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import { createTestCaller } from "../routers/setup";
import { seedHousehold, type Caller, type SeededIds } from "./seed";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";
import { PROCEDURES, callProcedure, procedureName } from "./procedures";

const clock = vi.hoisted(() => ({ turnTo: null as Date | null }));

vi.mock("@/server/data/request-scope", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/data/request-scope")>();
  return {
    ...actual,
    createRequestScope: (
      ...args: Parameters<typeof actual.createRequestScope>
    ) => {
      const scope = actual.createRequestScope(...args);
      if (clock.turnTo) vi.setSystemTime(clock.turnTo);
      return scope;
    },
  };
});

const LAST_MOMENT = new Date(2026, 11, 31, 23, 59, 59, 999);
const NEW_YEAR = new Date(LAST_MOMENT.getTime() + 1);

/** A household with jobs, contributions, a mortgage and a portfolio. */
const KEY = "ws-h3";

const ISO_INSTANT = /"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)"/g;

/** Each query's result, or the message it threw, with what moves on its
 *  own masked: a write stamp within a second of the turn (either side of
 *  it), a row's database-default stamp from seeding (SQLite's own clock,
 *  never faked) and the Simulation's run time. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  let text: string;
  try {
    text = JSON.stringify(await run());
  } catch (error) {
    text = `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  const realNow = vi.getRealSystemTime();
  return text
    .replace(ISO_INSTANT, (whole, iso: string) => {
      const t = Date.parse(iso);
      if (Math.abs(t - LAST_MOMENT.getTime()) <= 1000) return '"<turn>"';
      if (Math.abs(t - realNow) <= 3_600_000) return '"<seeded>"';
      return whole;
    })
    .replace(/"computeTimeMs":\d+/g, '"computeTimeMs":0');
}

describe(`one year per request: ${KEY}`, () => {
  const household = REVIEWED_HOUSEHOLDS.find((h) => h.key === KEY)!;
  const harnesses: Awaited<ReturnType<typeof createTestCaller>>[] = [];
  const ids: SeededIds[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LAST_MOMENT });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
    // Two copies: no cache one run fills is read by the other.
    for (let i = 0; i < 2; i++) {
      const harness = await createTestCaller();
      harnesses.push(harness);
      ids.push(await seedHousehold(harness.caller, household));
    }
  }, 120_000);

  afterAll(() => {
    clock.turnTo = null;
    for (const harness of harnesses) harness.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("every query returns the same when the year turns mid-request", async () => {
    const held: Record<string, string> = {};
    const turned: Record<string, string> = {};
    for (const p of PROCEDURES) {
      const name = procedureName(p);
      for (const [i, into] of [held, turned].entries()) {
        const input = p.input?.({ household, ids: ids[i]! });
        if (input === null) continue;
        vi.setSystemTime(LAST_MOMENT);
        clock.turnTo = i === 0 ? null : NEW_YEAR;
        into[name] = await outcome(() =>
          callProcedure(harnesses[i]!.caller, p, input),
        );
        clock.turnTo = null;
      }
    }
    expect(Object.keys(turned).length).toBeGreaterThan(50);
    const moved = Object.keys(held).filter((n) => turned[n] !== held[n]);
    expect(moved).toEqual([]);
  }, 600_000);
});

/** A write, given its household copy's caller and ids. */
interface WriteCase {
  name: string;
  write: (caller: Caller, ids: SeededIds) => Promise<unknown>;
}

const WRITES: WriteCase[] = [
  {
    // Within the limit: saved. Judged on 2027 it would find no limits.
    name: "a 401(k) raise within the limit is saved",
    write: (caller, ids) =>
      caller.contributionProfile.setAccountActiveFields({
        profileId: ids.contributionProfile,
        accountId: ids.contrib[0]!,
        fields: { contributionValue: "12" },
      }),
  },
  {
    name: "a 401(k) raise past the limit is refused with the year's limit",
    write: (caller, ids) =>
      caller.contributionProfile.setAccountActiveFields({
        profileId: ids.contributionProfile,
        accountId: ids.contrib[0]!,
        fields: { contributionValue: "60" },
      }),
  },
  {
    name: "turning the HSA back on is judged against the year's limit",
    write: (caller, ids) =>
      caller.contribution.accounts.setActive({
        id: ids.contrib[1]!,
        isActive: true,
      }),
  },
  {
    name: "a prior-year HSA amount is stored against last year",
    write: (caller, ids) =>
      caller.contribution.accounts.setPriorYearAmount({
        id: ids.contrib[1]!,
        priorYearContribAmount: "1000",
      }),
  },
];

describe(`one year per write: ${KEY}`, () => {
  const household = REVIEWED_HOUSEHOLDS.find((h) => h.key === KEY)!;
  const harnesses: Awaited<ReturnType<typeof createTestCaller>>[] = [];
  const ids: SeededIds[] = [];

  /** The rows the writes touch, as text (stamps masked like answers). */
  const rows = (i: number) =>
    outcome(async () => {
      const db = harnesses[i]!.db;
      return {
        accounts: await db.select().from(sqliteSchema.contributionAccounts),
        profiles: await db.select().from(sqliteSchema.contributionProfiles),
      };
    });

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LAST_MOMENT });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
    for (let i = 0; i < 2; i++) {
      const harness = await createTestCaller();
      harnesses.push(harness);
      ids.push(await seedHousehold(harness.caller, household));
    }
  }, 120_000);

  afterAll(() => {
    clock.turnTo = null;
    for (const harness of harnesses) harness.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("every write answers and saves the same when the year turns mid-request", async () => {
    const moved: string[] = [];
    for (const w of WRITES) {
      const answers: string[] = [];
      for (const i of [0, 1]) {
        vi.setSystemTime(LAST_MOMENT);
        clock.turnTo = i === 0 ? null : NEW_YEAR;
        answers.push(
          await outcome(() => w.write(harnesses[i]!.caller, ids[i]!)),
        );
        clock.turnTo = null;
      }
      vi.setSystemTime(LAST_MOMENT);
      if (answers[0] !== answers[1]) moved.push(`${w.name}: answer`);
      if ((await rows(0)) !== (await rows(1))) moved.push(`${w.name}: rows`);
    }
    expect(moved).toEqual([]);
  }, 120_000);

  it("the writes reach the judge: one saved, one refused on 2026's limit", async () => {
    vi.setSystemTime(LAST_MOMENT);
    const [saved, refused] = await Promise.all(
      WRITES.slice(0, 2).map((w) =>
        outcome(() => w.write(harnesses[0]!.caller, ids[0]!)),
      ),
    );
    expect(saved).not.toMatch(/^threw/);
    // 2026's 401(k) limit is $24,500: 60% of $140,000 is $59,500 over it.
    expect(refused).toBe(
      "threw: Cameron 401k: $59,500 over the IRS limit — set it to at most 17.5% of pay.",
    );
  });
});
