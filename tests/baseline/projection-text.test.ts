/**
 * Behavior baseline: the engine result's text and flags (v0.10.3 plan
 * commit 3, owner Q4: added as pins). Part c keeps numbers only, so the
 * engine's warnings (each year's, and the input's) and each account-year's
 * strings and flags (`eligibilityReason`, `eligibilityLocked`,
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
import { PIN_DIRS, projectionText, type TextTree } from "./pin-runs";

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

describe("the engine result's text and flags", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s",
    async (key, household) => {
      const { caller, cleanup } = await createTestCaller();
      let text: TextTree;
      try {
        const ids = await seedHousehold(caller, household);
        text = await projectionText(caller, household, ids);
      } finally {
        await cleanup();
      }
      const file = path.join(DIR, `${key}.json`);
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
    },
    120_000,
  );
});
