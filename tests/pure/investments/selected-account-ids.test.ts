import { describe, it, expect } from "vitest";
import { selectedAccountIdsFrom } from "@/lib/pure/investments/selected-account-ids";

const all = new Set([3, 12, 40]);

describe("selectedAccountIdsFrom", () => {
  it("reads one account stored as a string or as a number", () => {
    expect(selectedAccountIdsFrom("12", all)).toEqual(new Set([12]));
    expect(selectedAccountIdsFrom(12, all)).toEqual(new Set([12]));
  });

  it("reads several accounts", () => {
    expect(selectedAccountIdsFrom("3,40", all)).toEqual(new Set([3, 40]));
  });

  it("is empty when chosen empty, and every account when never chosen", () => {
    expect(selectedAccountIdsFrom("none", all)).toEqual(new Set());
    expect(selectedAccountIdsFrom("", all)).toBe(all);
    expect(selectedAccountIdsFrom(null, all)).toBe(all);
  });
});
