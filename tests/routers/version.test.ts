/**
 * Version router integration tests.
 *
 * Tests listing, querying, and auth for state version management.
 */
import "./setup-mocks";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCaller, viewerSession } from "./setup";

describe("version router", () => {
  let caller: Awaited<ReturnType<typeof createTestCaller>>["caller"];
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await createTestCaller();
    caller = ctx.caller;
    cleanup = ctx.cleanup;
  });

  afterAll(() => cleanup());

  describe("list", () => {
    it("returns empty array when no versions exist", async () => {
      const versions = await caller.version.list();
      expect(versions).toEqual([]);
    });
  });

  describe("getById", () => {
    it("returns null for nonexistent version", async () => {
      const version = await caller.version.getById({ id: 999 });
      expect(version).toBeNull();
    });

    it("rejects non-integer id", async () => {
      await expect(caller.version.getById({ id: 1.5 })).rejects.toThrow();
    });
  });

  describe("auth", () => {
    it("viewer can list versions", async () => {
      const { caller: viewerCaller, cleanup: vc } =
        await createTestCaller(viewerSession);
      try {
        const versions = await viewerCaller.version.list();
        expect(Array.isArray(versions)).toBe(true);
      } finally {
        vc();
      }
    });
  });
});
