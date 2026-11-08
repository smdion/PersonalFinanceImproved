/**
 * Behavior baseline: the engine result's text and flags (v0.10.3 plan
 * commit 3, owner Q4: added as pins). Part c keeps numbers only, so the
 * engine's warnings (each year's, and the input's) and each account-year's
 * strings and flags (`draw.reason`, `draw.eligibilityLocked`,
 * `projectedOnly`, the names and tax types) reach no pinned file there;
 * the engine snapshots keep only a warning count. The stages of v0.10.3
 * move the code that pushes them.
 *
 * Each household is seeded as the router baseline seeds it (router-suite.ts:
 * its clock, its simulations, no network) and `projection.computeProjection`
 * called with the router baseline's input. What is kept of `result`: every
 * string that isn't only a number, and every boolean, in the result's
 * shape (textTree); numbers, ids and timestamps are part c's. It must equal
 * `__text__/<household>.json`. The baseline rule in router-baseline.test.ts
 * governs these files too; `LEDGR_BASELINE_WRITE=1` writes them.
 *
 * The same for the Simulation and Coast FIRE rows (v0.10.4 plan commit
 * 27c, owner Q2: added as pins), whose `draw` and `roth` flags and reasons
 * no file compared: each of `computeCoastFire`, `computeCoastFireMC`,
 * `computeCoastFireProbe` and `computeMonteCarloProjection`, called with
 * the router baseline's input, kept the same way, must equal
 * `__text__/<household>.simulation.json` (pin-runs.ts simulationText).
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
import {
  PIN_DIRS,
  projectionText,
  simulationText,
  type TextTree,
} from "./pin-runs";

const DIR = PIN_DIRS.text;

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

/** The text must equal `<name>.json` (or is written to it). */
function expectPinned(name: string, text: TextTree) {
  const file = path.join(DIR, `${name}.json`);
  if (REGENERATE) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(text, null, 1)}\n`);
    return;
  }
  expect(
    fs.existsSync(file),
    `no baseline file ${path.relative(process.cwd(), file)}`,
  ).toBe(true);
  expect(text).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** `read`'s text on a freshly seeded household. */
function seededText(
  read: typeof projectionText,
): (household: (typeof HOUSEHOLDS)[number]) => Promise<TextTree> {
  return async (household) => {
    const { caller, cleanup } = await createTestCaller();
    try {
      const ids = await seedHousehold(caller, household);
      return await read(caller, household, ids);
    } finally {
      await cleanup();
    }
  };
}

describe("the engine result's text and flags", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s",
    async (key, household) => {
      expectPinned(key, await seededText(projectionText)(household));
    },
    120_000,
  );
});

describe("the Simulation and Coast FIRE rows' text and flags", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s",
    async (key, household) => {
      expectPinned(
        `${key}.simulation`,
        await seededText(simulationText)(household),
      );
    },
    120_000,
  );
});
