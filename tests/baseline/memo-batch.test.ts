/**
 * The request memo (`scope.load`), as a dashboard batch meets it: every
 * baseline query called at once through one memo-bearing context gives
 * exactly what each gives called alone with none. The baseline files can't
 * show this: their contexts carry no memo. Shared rows are frozen, so a
 * query that changed one would throw here.
 */
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createCallerFactory } from "@/server/trpc";
import { createReadMemo } from "@/server/data/request-scope";
import { appRouter } from "@/server/routers";
import { adminSession, createTestCaller } from "../routers/setup";
import { seedHousehold, type Caller, type SeededIds } from "./seed";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";
import { PROCEDURES, callProcedure, procedureName } from "./procedures";
import { BASELINE_NOW } from "./router-suite";

/** Two people (row order shows) and one earner. */
const KEYS = ["ws-h3", "ws-h4"];

/** Each query's result, or the message it threw. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await run());
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

describe.each(KEYS)("one memo for a whole batch: %s", (key) => {
  const household = REVIEWED_HOUSEHOLDS.find((h) => h.key === key)!;
  let harness: Awaited<ReturnType<typeof createTestCaller>>;
  let ids: SeededIds;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
    );
    harness = await createTestCaller();
    ids = await seedHousehold(harness.caller, household);
  }, 120_000);

  afterAll(() => {
    harness.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("every query, all at once, equals each alone", async () => {
    const calls = PROCEDURES.flatMap((p) => {
      const input = p.input?.({ household, ids });
      return input === null ? [] : [{ p, input }];
    });
    const alone: Record<string, string> = {};
    for (const { p, input } of calls)
      alone[procedureName(p)] = await outcome(() =>
        callProcedure(harness.caller, p, input),
      );

    const batch: Caller = createCallerFactory(appRouter)({
      db: harness.rawDb,
      session: adminSession,
      demoSchema: null,
      reads: createReadMemo({ freeze: true }),
    });
    const together = await Promise.all(
      calls.map(async ({ p, input }) => [
        procedureName(p),
        await outcome(() => callProcedure(batch, p, input)),
      ]),
    );
    expect(Object.fromEntries(together)).toEqual(alone);
  }, 300_000);
});
