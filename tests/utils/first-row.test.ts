import { describe, expect, it } from "vitest";
import { firstRow } from "@/lib/utils/first-row";

describe("firstRow", () => {
  it("returns the first row", () => {
    expect(firstRow([{ id: 1 }, { id: 2 }])).toEqual({ id: 1 });
  });

  it("returns undefined for no rows", () => {
    expect(firstRow([])).toBeUndefined();
  });

  it("reads a query's result through then", async () => {
    expect(await Promise.resolve([7, 8]).then(firstRow)).toBe(7);
  });
});
