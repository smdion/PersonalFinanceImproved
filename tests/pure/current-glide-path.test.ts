import { describe, it, expect } from "vitest";
import {
  currentGlidePathSchema,
  parseCurrentGlidePath,
} from "@/lib/pure/current-glide-path";

describe("current glide path", () => {
  const path = [
    { age: 50, allocations: { "1": 0.5, "2": 0.5 } },
    { age: 40, allocations: { "1": 0.7, "2": 0.299 } },
  ];

  it("accepts mixes that add to 100% (within rounding) and sorts by age", () => {
    expect(currentGlidePathSchema.safeParse(path).success).toBe(true);
    expect(parseCurrentGlidePath(path)).toEqual([
      { age: 40, allocations: { 1: 0.7, 2: 0.299 } },
      { age: 50, allocations: { 1: 0.5, 2: 0.5 } },
    ]);
  });

  it("rejects a mix that doesn't add up, a repeated age, or nothing", () => {
    expect(
      currentGlidePathSchema.safeParse([
        { age: 40, allocations: { "1": 0.6, "2": 0.3 } },
      ]).success,
    ).toBe(false);
    expect(
      currentGlidePathSchema.safeParse([path[0], { ...path[0] }]).success,
    ).toBe(false);
    expect(currentGlidePathSchema.safeParse([]).success).toBe(false);
  });

  it("reads unset or bad data as none (the retirement glide path applies)", () => {
    expect(parseCurrentGlidePath(null)).toBeNull();
    expect(parseCurrentGlidePath([{ age: "forty" }])).toBeNull();
  });
});
