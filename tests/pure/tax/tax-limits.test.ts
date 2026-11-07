import { describe, it, expect } from "vitest";
import { requireLimit } from "@/lib/pure/tax/tax-limits";

describe("requireLimit", () => {
  describe("with Record", () => {
    it("returns value for existing key", () => {
      const limits = { "2025_401k_limit": 23500, "2025_ira_limit": 7000 };
      expect(requireLimit(limits, "2025_401k_limit")).toBe(23500);
    });

    it("throws for missing key", () => {
      const limits = { "2025_401k_limit": 23500 };
      expect(() => requireLimit(limits, "2025_ira_limit")).toThrow(
        'Missing required IRS limit "2025_ira_limit"',
      );
    });

    it("returns 0 when value is 0", () => {
      const limits = { some_limit: 0 };
      expect(requireLimit(limits, "some_limit")).toBe(0);
    });
  });

  describe("with Map", () => {
    it("returns value for existing key", () => {
      const limits = new Map([["2025_401k_limit", 23500]]);
      expect(requireLimit(limits, "2025_401k_limit")).toBe(23500);
    });

    it("throws for missing key", () => {
      const limits = new Map<string, number>();
      expect(() => requireLimit(limits, "missing")).toThrow(
        'Missing required IRS limit "missing"',
      );
    });
  });
});
