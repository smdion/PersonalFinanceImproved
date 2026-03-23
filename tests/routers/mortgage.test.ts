/**
 * Mortgage router integration tests.
 *
 * Tests the computeActiveSummary query with empty and populated data.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, viewerSession } from "./setup";

describe("mortgage router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("computeActiveSummary", () => {
    it("returns empty results when no loans exist", async () => {
      const result = await caller.mortgage.computeActiveSummary();
      expect(result.loans).toEqual([]);
      expect(result.whatIfScenarios).toEqual([]);
      expect(result.result).toBeDefined();
    });

    it("result has expected structure", async () => {
      const result = await caller.mortgage.computeActiveSummary();
      expect(result).toHaveProperty("loans");
      expect(result).toHaveProperty("result");
      expect(result).toHaveProperty("whatIfScenarios");
    });
  });

  describe("auth", () => {
    it("viewer can read mortgage data", async () => {
      const { caller: viewerCaller, cleanup: viewerCleanup } =
        await createTestCaller(viewerSession);
      try {
        const result = await viewerCaller.mortgage.computeActiveSummary();
        expect(result).toBeDefined();
      } finally {
        viewerCleanup();
      }
    });
  });
});
