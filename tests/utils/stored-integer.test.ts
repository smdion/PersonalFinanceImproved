/**
 * A stored integer setting reads as the integer however it was stored: a
 * number, or the digit string an older PostgreSQL write left.
 */
import { describe, it, expect } from "vitest";
import { storedInteger } from "@/lib/utils/stored-integer";

describe("storedInteger", () => {
  it.each([
    [2, 2],
    ["2", 2],
    [0, 0],
    ["0", 0],
  ])("reads %j as %j", (raw, value) => {
    expect(storedInteger(raw, null)).toBe(value);
  });

  it.each([[undefined], [null], ["two"], ["1.5"], [1.5], ["-1"], [true], [{}]])(
    "reads %j as unset",
    (raw) => {
      expect(storedInteger(raw, null)).toBeNull();
      expect(storedInteger(raw, 0)).toBe(0);
    },
  );
});
