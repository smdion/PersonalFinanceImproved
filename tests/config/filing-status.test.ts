import { describe, it, expect } from "vitest";
import {
  FILING_STATUS_ORDER,
  FILING_STATUS_RULES,
  parseReturnFilingStatus,
} from "@/lib/config/filing-status";

describe("filing status", () => {
  it("lists every return status in order", () => {
    expect(FILING_STATUS_ORDER).toEqual(["MFJ", "Single", "HOH"]);
  });

  it("puts two people on a joint return, one on the others", () => {
    expect(FILING_STATUS_RULES.MFJ.peopleOnReturn).toBe(2);
    expect(FILING_STATUS_RULES.Single.peopleOnReturn).toBe(1);
    expect(FILING_STATUS_RULES.HOH.peopleOnReturn).toBe(1);
  });

  it("parses the three statuses and nothing else", () => {
    expect(parseReturnFilingStatus("HOH")).toBe("HOH");
    expect(parseReturnFilingStatus("MFS")).toBeNull();
    expect(parseReturnFilingStatus(null)).toBeNull();
  });
});
