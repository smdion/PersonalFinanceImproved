/**
 * One request, one year (RULES § Time Resolution): every query reads its
 * date from the request scope, so a clock that turns over to the next year
 * while the request runs changes nothing it returns. Each query is called
 * twice on its own copy of the household, the scope made at 23:59:59.999
 * on Dec 31: once with the clock held there, once with the clock moved to
 * Jan 1 right after the scope is made. A query that reads the clock itself
 * sees the new year in the second call.
 */
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedHousehold, type SeededIds } from "./seed";
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

/** Queries that still read the clock themselves, through library
 *  helpers (v0.10.5 12b); only shrinks. */
const STILL_READ_THE_CLOCK: string[] = ["settings.taxData.status"];

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
    expect(moved).toEqual(STILL_READ_THE_CLOCK);
  }, 600_000);
});
