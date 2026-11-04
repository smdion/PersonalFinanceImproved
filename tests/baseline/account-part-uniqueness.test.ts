/**
 * The uniqueness check for the engine's account key (`makeIndKey`, built
 * from the display name) switching to the account id: every entry of
 * a household's `accountBreakdownByCategory` must come from one
 * performance account. An entry with two ids is two accounts merged on
 * (name, category, tax type, owner), and keying on the id would move that
 * household's figures. Seeds each baseline household the way the router
 * baseline does (router-suite.ts) and reads the projection's breakdown.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedHousehold, type Household } from "./seed";
import { HOUSEHOLDS } from "./households";
import { PROCEDURES, callProcedure } from "./procedures";

/** The router baseline's clock (router-suite.ts). */
const BASELINE_NOW = new Date("2026-03-07T18:00:00.000Z");

/** The households where two accounts merge today: each is a v0.11 bug. */
const MERGED = "el-h5";

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;

type Breakdown = Record<string, { performanceAccountIds?: number[] }[]>;

/** The breakdown entries that more than one performance account feeds. */
async function mergedEntries(household: Household): Promise<string[]> {
  const { caller, cleanup } = await createTestCaller();
  try {
    const ids = await seedHousehold(caller, household);
    const result = (await callProcedure(
      caller,
      projection,
      projection.input?.({ household, ids }),
    )) as { accountBreakdownByCategory?: Breakdown };
    const breakdown = result.accountBreakdownByCategory;
    expect(breakdown, `${household.key}: no breakdown`).toBeDefined();
    return Object.entries(breakdown!).flatMap(([category, entries]) =>
      entries
        .filter((e) => (e.performanceAccountIds?.length ?? 0) !== 1)
        .map((e) => `${category}: ${e.performanceAccountIds?.length ?? 0} ids`),
    );
  } finally {
    await cleanup();
  }
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
  );
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("one performance account per account breakdown entry", () => {
  it.each(
    HOUSEHOLDS.filter((h) => h.key !== MERGED).map((h) => [h.key, h] as const),
  )(
    "%s",
    async (_key, household) => {
      expect(await mergedEntries(household)).toEqual([]);
    },
    60_000,
  );

  it.fails(
    "v0.11 el-h5: its Retirement and Portfolio brokerages share a name and owner, so they merge into one entry (the account key switches to the id then)",
    async () => {
      const household = HOUSEHOLDS.find((h) => h.key === MERGED)!;
      expect(await mergedEntries(household)).toEqual([]);
    },
    60_000,
  );
});
