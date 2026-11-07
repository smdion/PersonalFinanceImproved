/**
 * Behavior baseline, part d: the rows `performance.finalizeYear` writes
 * (v0.10.3 plan commit 3; owner Q4: added as pins). The router baseline
 * pins queries only, and this mutation is the one the plan stages.
 *
 * Each household (households.ts) is seeded as the router baseline seeds
 * it, on its clock (BASELINE_NOW) with no network. Each of its performance
 * accounts gets a 2025 account_performance row, invented from its snapshot
 * total, and each person a 2025 salary (their job's, or 0); 2025 is
 * finalized, then 2026 from the rows that finalize made (its salary from
 * the active Salary Profile), so the second finalize reads the first
 * one's lifetime figures. Every row
 * each finalize adds or changes (account_performance and next year's rows,
 * annual_performance, net_worth_annual, the stored settings, anything
 * else; every column but timestamps), and how many rows it replaced or
 * removed, must equal `__sync__/finalize/<household>.json`. A call that
 * threw is recorded as `{ "$threw": <message> }`. These pin today's
 * behavior, bugs included. The baseline rule in router-baseline.test.ts
 * governs these files too; `LEDGR_BASELINE_WRITE=1` writes them.
 *
 * One variant (v0.10.4 plan commit 27a, owner Q2: added as pins) takes
 * the paths the households don't: no snapshot, next year's account and
 * annual rows already there, a stored year-end row to update, and the
 * same year finalized twice (pin-runs.ts finalizeVariantWrites).
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { BASELINE_NOW, REGENERATE } from "./router-suite";
import { tableRows } from "./table-rows";
import {
  FINALIZE_VARIANT,
  PIN_DIRS,
  finalizeVariantHousehold,
  finalizeVariantWrites,
  finalizeWrites,
} from "./pin-runs";

const DIR = PIN_DIRS.finalize;

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

/** The written rows must equal `<key>.json` (or are written to it). */
function expectPinned(key: string, written: Record<string, unknown>) {
  const file = path.join(DIR, `${key}.json`);
  if (REGENERATE) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(written, null, 1)}\n`);
    return;
  }
  expect(
    fs.existsSync(file),
    `no baseline file ${path.relative(process.cwd(), file)}`,
  ).toBe(true);
  expect(written).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
}

describe.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
  "finalize writes: %s",
  (key, household) => {
    let ctx: Awaited<ReturnType<typeof createTestCaller>>;
    let written: Record<string, unknown> = {};

    beforeAll(async () => {
      ctx = await createTestCaller();
      const { caller } = ctx;
      const ids = await seedHousehold(caller, household);
      written = await finalizeWrites(caller, household, ids, async () =>
        tableRows(ctx.db),
      );
    }, 120_000);

    afterAll(() => ctx?.cleanup());

    it("writes the pinned rows", () => {
      expectPinned(key, written);
    });
  },
);

describe(`finalize writes: ${FINALIZE_VARIANT.key}`, () => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let written: Record<string, unknown> = {};

  beforeAll(async () => {
    ctx = await createTestCaller();
    const base = HOUSEHOLDS.find((h) => h.key === FINALIZE_VARIANT.base)!;
    const ids = await seedHousehold(ctx.caller, finalizeVariantHousehold(base));
    written = await finalizeVariantWrites(
      ctx.caller,
      base,
      ids,
      async () => tableRows(ctx.db),
      ctx.rawDb,
    );
  }, 120_000);

  afterAll(() => ctx?.cleanup());

  it("writes the pinned rows", () => {
    expectPinned(FINALIZE_VARIANT.key, written);
  });

  it("reaches each path it is for", () => {
    const first = written["2025"] as Record<
      string,
      { written: Record<string, unknown>[]; replacedOrRemoved: number }
    >;
    // No snapshot: the breakdown read none; the stored row was updated.
    const nw = first.net_worth_annual!;
    expect(nw.replacedOrRemoved).toBe(1);
    expect(nw.written).toHaveLength(1);
    expect(nw.written[0]).toMatchObject({
      combinedAgi: "98765",
      taxesPaid: "12345",
      portfolioByTaxLocation: { retirement: {}, portfolio: {} },
    });
    // 2026's existing account row and annual rows were kept, not added.
    const next = (table: string) =>
      first[table]!.written.filter((r) => r.year === 2026);
    expect(next("account_performance")).toHaveLength(2);
    expect(next("annual_performance").map((r) => r.category)).not.toContain(
      "Portfolio",
    );
    // The second finalize was refused and wrote nothing.
    const again = written["2025 again"] as { $threw: string; wrote: object };
    expect(again.$threw).toContain("already finalized");
    expect(again.wrote).toEqual({});
  });
});
