/**
 * The two balance tracks agree for every baseline household: its
 * projection reports no indBal/acctBal reconciliation warning (the
 * baseline files keep numbers only, so a warning can't fail them).
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { HOUSEHOLDS } from "./households";
import { BASELINE_NOW } from "./router-suite";
import { PROCEDURES, callProcedure } from "./procedures";
import { seedHousehold } from "./seed";
import { driftIn } from "../calculators/fixtures/drift";

/** Households whose two balance tracks drift today. */
const KNOWN_DRIFT = ["ws-h1"];

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;

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

describe.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
  "%s",
  (key, household) => {
    const run = async () => {
      const { caller, cleanup } = await createTestCaller();
      try {
        const ids = await seedHousehold(caller, household);
        const input = projection.input?.({ household, ids });
        return await callProcedure(caller, projection, input);
      } finally {
        await cleanup();
      }
    };
    const title = "projection has no indBal/acctBal drift";
    if (KNOWN_DRIFT.includes(key)) {
      it.fails(
        `${title} (v0.11 Engine: two balance tracks become one)`,
        async () => {
          const output = await run();
          expect(output).toHaveProperty("result.projectionByYear");
          expect(driftIn(output)).toEqual([]);
        },
        60_000,
      );
    } else {
      it(
        title,
        async () => {
          const output = await run();
          expect(output).toHaveProperty("result.projectionByYear");
          expect(driftIn(output)).toEqual([]);
        },
        60_000,
      );
    }
  },
);
