import { describe, it, expect } from "vitest";
import { encodeJsonbForPgImport } from "@/lib/db/jsonb-import";

describe("encodeJsonbForPgImport", () => {
  describe("sourceDialect: postgres", () => {
    it("stringifies an object (the normal PG jsonb shape)", () => {
      expect(encodeJsonbForPgImport({ a: 1 }, "postgres")).toBe('{"a":1}');
    });

    it("stringifies an array", () => {
      expect(encodeJsonbForPgImport([1, 2, 3], "postgres")).toBe("[1,2,3]");
    });

    it("stringifies a bare string scalar (node-pg parses jsonb '\"x\"' to the JS string x)", () => {
      expect(
        encodeJsonbForPgImport("2026-09-05T22:04:49.000Z", "postgres"),
      ).toBe('"2026-09-05T22:04:49.000Z"');
    });

    it("stringifies a number scalar", () => {
      expect(encodeJsonbForPgImport(42, "postgres")).toBe("42");
    });
  });

  describe("sourceDialect: sqlite", () => {
    it("passes an already-serialized JSON string through unchanged", () => {
      const serialized = JSON.stringify({ a: 1 });
      expect(encodeJsonbForPgImport(serialized, "sqlite")).toBe(serialized);
    });

    it("does not double-encode an already-serialized string scalar", () => {
      const serialized = JSON.stringify("2026-09-05T22:04:49.000Z");
      expect(encodeJsonbForPgImport(serialized, "sqlite")).toBe(serialized);
    });

    it("still stringifies a raw object as a fallback", () => {
      expect(encodeJsonbForPgImport({ a: 1 }, "sqlite")).toBe('{"a":1}');
    });
  });

  describe("sourceDialect undefined (legacy backup, no field)", () => {
    it("falls back to postgres behavior — always stringify", () => {
      expect(
        encodeJsonbForPgImport("2026-09-05T22:04:49.000Z", undefined),
      ).toBe('"2026-09-05T22:04:49.000Z"');
      expect(encodeJsonbForPgImport({ a: 1 }, undefined)).toBe('{"a":1}');
    });
  });
});
