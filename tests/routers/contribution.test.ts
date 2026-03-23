/**
 * Contribution router integration tests.
 *
 * Tests the contribution computation pipeline with various data states.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, seedPerson, viewerSession } from "./setup";

describe("contribution router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let db: Awaited<ReturnType<typeof createTestCaller>>["db"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    db = ctx.db;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("computeSummary", () => {
    it("returns empty when no people exist", async () => {
      const result = await caller.contribution.computeSummary();
      expect(result).toBeDefined();
      expect(result.people).toEqual([]);
    });

    it("returns person data when a person exists", async () => {
      await seedPerson(db, "Alice", "1985-06-15");
      const result = await caller.contribution.computeSummary();
      expect(result.people.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("auth", () => {
    it("viewer can read contribution data", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const result = await viewerCaller.contribution.computeSummary();
        expect(result).toBeDefined();
      } finally {
        vc();
      }
    });
  });
});
