import { describe, it, expect } from "vitest";
import {
  FILING_STATUS_ORDER,
  FILING_STATUS_RULES,
  jointTable,
  parseReturnFilingStatus,
  survivorTable,
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

  it("reads each status's own tax-table row for both kinds of rule", () => {
    const table = { MFJ: "m", Single: "s", HOH: "h" } as const;
    for (const status of ["MFJ", "Single", "HOH"] as const) {
      expect(survivorTable(table, status)).toBe(table[status]);
      expect(jointTable(table, status)).toBe(table[status]);
    }
    expect(FILING_STATUS_RULES.MFJ.marriedAddOn).toBe(true);
    expect(FILING_STATUS_RULES.Single.marriedAddOn).toBe(false);
    expect(FILING_STATUS_RULES.HOH.marriedAddOn).toBe(false);
  });

  it("parses the three statuses and nothing else", () => {
    expect(parseReturnFilingStatus("HOH")).toBe("HOH");
    expect(parseReturnFilingStatus("MFS")).toBeNull();
    expect(parseReturnFilingStatus(null)).toBeNull();
  });
});
