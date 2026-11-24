import { describe, it, expect } from "vitest";
import { readProfileFilingStatus } from "@/lib/pure/tax/filing-status";

describe("readProfileFilingStatus", () => {
  it("reads null as Auto and a known status as itself, with no note", () => {
    expect(readProfileFilingStatus(null)).toEqual({ value: null, notes: [] });
    expect(readProfileFilingStatus("HOH")).toEqual({
      value: "HOH",
      notes: [],
    });
  });

  it("reads a stored value outside the four as Auto, with a note naming it", () => {
    expect(readProfileFilingStatus("MFS")).toEqual({
      value: null,
      notes: [
        "The Retirement Profile's saved filing status \"MFS\" isn't one this version knows, so the projection uses Auto (this year's status). Update Ledgr or pick a filing status.",
      ],
    });
  });
});
