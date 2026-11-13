/**
 * The two balance tracks agree for every baseline household: its
 * projection reports no indBalance/accountBalance reconciliation warning (the
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
import { driftIn } from "../pure/fixtures/drift";

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
  (_key, household) => {
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
    it("projection has no indBal/acctBal drift", async () => {
      const output = await run();
      expect(output).toHaveProperty("result.projectionByYear");
      expect(driftIn(output)).toEqual([]);
    }, 60_000);
  },
);
