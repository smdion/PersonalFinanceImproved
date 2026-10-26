import { describe, it, expect } from "vitest";
import {
  redundantReturnRateIds,
  returnRateAtAge,
} from "@/lib/pure/return-rate-breakpoints";

describe("redundantReturnRateIds", () => {
  it("returns rows that repeat the previous breakpoint's rate", () => {
    const rows = [
      { id: 3, age: 66, rateOfReturn: "0.055000" },
      { id: 1, age: 64, rateOfReturn: "0.056" },
      { id: 2, age: 65, rateOfReturn: "0.055" },
      { id: 4, age: 67, rateOfReturn: 0.055 },
      { id: 5, age: 68, rateOfReturn: "0.06" },
    ];
    expect(redundantReturnRateIds(rows)).toEqual([3, 4]);
  });

  it("keeps the first row and an empty table alone", () => {
    expect(redundantReturnRateIds([])).toEqual([]);
    expect(
      redundantReturnRateIds([{ id: 1, age: 20, rateOfReturn: "0.1" }]),
    ).toEqual([]);
  });
});

describe("returnRateAtAge", () => {
  const map = new Map([
    [65, 0.05],
    [20, 0.1],
    [40, 0.08],
  ]);
  it("takes the highest breakpoint at or below the age, in any order", () => {
    expect(returnRateAtAge(map, 20)).toBe(0.1);
    expect(returnRateAtAge(map, 39)).toBe(0.1);
    expect(returnRateAtAge(map, 40)).toBe(0.08);
    expect(returnRateAtAge(map, 104)).toBe(0.05);
  });
  it("is null below the first breakpoint", () => {
    expect(returnRateAtAge(map, 19)).toBeNull();
    expect(returnRateAtAge([], 30)).toBeNull();
  });
});
