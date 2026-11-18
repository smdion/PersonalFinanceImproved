/**
 * The uniqueness check for the engine's account key (`makeIndKey`, built
 * from the display name) switching to the account id, both ways: every entry
 * of a household's `accountBreakdownByCategory` comes from one performance
 * account, and no two of the engine's parts share an id key
 * (`accountIdKeyOf`). Seeds each baseline household the way the router
 * baseline does (router-suite.ts) and reads the projection's breakdown and
 * the engine's input.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedHousehold, type Household } from "./seed";
import { HOUSEHOLDS } from "./households";
import { PROCEDURES, callProcedure } from "./procedures";
import { accountIdKeyOf } from "@/lib/pure/accounts/account-part";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";

/** Each engine run's parts, in call order. */
const { runs } = vi.hoisted(() => ({
  runs: [] as (readonly IndividualAccountInput[])[],
}));
vi.mock("@/lib/pure/engine/projection", async (importOriginal) => {
  const engine =
    await importOriginal<typeof import("@/lib/pure/engine/projection")>();
  return {
    ...engine,
    calculateProjection: (
      input: Parameters<typeof engine.calculateProjection>[0],
    ) => {
      runs.push(input.individualAccounts ?? []);
      return engine.calculateProjection(input);
    },
  };
});

/** The router baseline's clock (router-suite.ts). */
const BASELINE_NOW = new Date("2026-03-07T18:00:00.000Z");

/** The households where two accounts merge today: each is a v0.11 bug. */
const MERGED = "el-h5";

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;

type Breakdown = Record<string, { performanceAccountIds?: number[] }[]>;

/** Runs the household's projection: its breakdown, and each engine run's parts. */
async function project(household: Household): Promise<{
  breakdown: Breakdown;
  parts: (readonly IndividualAccountInput[])[];
}> {
  runs.length = 0;
  const { caller, cleanup } = await createTestCaller();
  try {
    const ids = await seedHousehold(caller, household);
    const result = (await callProcedure(
      caller,
      projection,
      projection.input?.({ household, ids }),
    )) as { accountBreakdownByCategory?: Breakdown };
    expect(
      result.accountBreakdownByCategory,
      `${household.key}: no breakdown`,
    ).toBeDefined();
    return { breakdown: result.accountBreakdownByCategory!, parts: [...runs] };
  } finally {
    await cleanup();
  }
}

/** The breakdown entries that more than one performance account feeds. */
async function mergedEntries(household: Household): Promise<string[]> {
  const { breakdown } = await project(household);
  return Object.entries(breakdown).flatMap(([category, entries]) =>
    entries
      .filter((e) => (e.performanceAccountIds?.length ?? 0) !== 1)
      .map((e) => `${category}: ${e.performanceAccountIds?.length ?? 0} ids`),
  );
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

describe("one engine part per id key", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s",
    async (_key, household) => {
      const { parts } = await project(household);
      expect(parts.length, `${household.key}: no engine run`).toBeGreaterThan(
        0,
      );
      for (const run of parts) {
        const keys = run.map((ia) => accountIdKeyOf(ia));
        expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
        // A part with no performance account is keyed by its snapshot row.
        for (const ia of run)
          if (ia.origin == null && ia.performanceAccountId == null)
            expect(accountIdKeyOf(ia)).toMatch(/^row:/);
      }
    },
    60_000,
  );
});
