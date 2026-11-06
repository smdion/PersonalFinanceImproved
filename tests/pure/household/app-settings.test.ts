import { describe, it, expect } from "vitest";
import { parseAppSettings } from "@/lib/pure/household/app-settings";

describe("parseAppSettings", () => {
  it("returns fallback for missing key", () => {
    const lookup = parseAppSettings([]);
    expect(lookup("missing_key", 42)).toBe(42);
  });

  it("returns stored number value", () => {
    const lookup = parseAppSettings([{ key: "rate", value: 0.07 }]);
    expect(lookup("rate", 0)).toBe(0.07);
  });

  it("returns fallback when value is a string", () => {
    const lookup = parseAppSettings([{ key: "rate", value: "not_a_number" }]);
    expect(lookup("rate", 99)).toBe(99);
  });

  it("returns fallback when value is null", () => {
    const lookup = parseAppSettings([{ key: "rate", value: null }]);
    expect(lookup("rate", 5)).toBe(5);
  });

  it("returns fallback when value is undefined", () => {
    const lookup = parseAppSettings([{ key: "rate", value: undefined }]);
    expect(lookup("rate", 5)).toBe(5);
  });

  it("handles multiple settings", () => {
    const lookup = parseAppSettings([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
      { key: "c", value: 3 },
    ]);
    expect(lookup("a", 0)).toBe(1);
    expect(lookup("b", 0)).toBe(2);
    expect(lookup("c", 0)).toBe(3);
  });

  it("last value wins for duplicate keys", () => {
    const lookup = parseAppSettings([
      { key: "rate", value: 1 },
      { key: "rate", value: 2 },
    ]);
    expect(lookup("rate", 0)).toBe(2);
  });

  it("returns 0 when stored value is 0", () => {
    const lookup = parseAppSettings([{ key: "rate", value: 0 }]);
    expect(lookup("rate", 99)).toBe(0);
  });
});
