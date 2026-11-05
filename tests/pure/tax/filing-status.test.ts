import { describe, it, expect } from "vitest";
import { storedProfileFilingStatus } from "@/lib/pure/tax/filing-status";

describe("storedProfileFilingStatus", () => {
  it("reads null as Auto and a known status as itself", () => {
    expect(storedProfileFilingStatus(null)).toBeNull();
    expect(storedProfileFilingStatus("HOH")).toBe("HOH");
  });

  it("stops on a stored value outside the three", () => {
    expect(() => storedProfileFilingStatus("MFS")).toThrow(/"MFS"/);
  });
});
