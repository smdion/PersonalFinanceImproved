/**
 * How many auto versions are kept: the stored count however it was stored,
 * 30 when unset, never under 1 (a 0 would delete every auto version).
 */
import { describe, it, expect } from "vitest";
import { versionRetention } from "@/lib/db/backup/version-retention";

describe("versionRetention", () => {
  it.each([
    [10, 10],
    ["10", 10],
    [undefined, 30],
    ["ten", 30],
    [0, 1],
    ["0", 1],
    [-3, 1],
  ])("reads a stored %j as %j", (raw, kept) => {
    expect(versionRetention(raw)).toBe(kept);
  });
});
