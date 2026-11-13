import { describe, it, expect } from "vitest";
import {
  FILING_STATUS_ORDER,
  FILING_STATUS_RULES,
  jointTable,
  parseReturnFilingStatus,
  PROJECTION_FILING_STATUSES,
  spousePair,
  survivorTable,
} from "@/lib/config/filing-status";
import {
  retirementFilingStatus,
  w4BoxSetting,
} from "@/lib/pure/tax/filing-status";
import { SK_TAX_FILING_STATUS } from "@/lib/constants/settings-keys";

describe("filing status", () => {
  it("lists every return status in order", () => {
    expect(FILING_STATUS_ORDER).toEqual(["MFJ", "Single", "HOH", "QSS"]);
  });

  it("puts two people on a joint return, one on the others", () => {
    expect(FILING_STATUS_RULES.MFJ.peopleOnReturn).toBe(2);
    expect(FILING_STATUS_RULES.Single.peopleOnReturn).toBe(1);
    expect(FILING_STATUS_RULES.HOH.peopleOnReturn).toBe(1);
    expect(FILING_STATUS_RULES.QSS.peopleOnReturn).toBe(1);
  });

  it("QSS reads the joint row for survivor rules, the single row for joint-only ones (IRC 2(a), 63(f)(3))", () => {
    const table = { MFJ: "m", Single: "s", HOH: "h" } as const;
    expect(survivorTable(table, "QSS")).toBe("m");
    expect(jointTable(table, "QSS")).toBe("s");
    expect(FILING_STATUS_RULES.QSS.marriedAddOn).toBe(true);
  });

  it("a new job's W-4 box: QSS ticks the joint one (W-4 Step 1(c))", () => {
    const stated = (value: unknown) => [{ key: SK_TAX_FILING_STATUS, value }];
    expect(w4BoxSetting(stated("QSS"))).toBe("MFJ");
    expect(w4BoxSetting(stated("HOH"))).toBe("HOH");
    expect(w4BoxSetting([])).toBeNull();
  });

  it("projection years file QSS as Single; the others as themselves", () => {
    expect(PROJECTION_FILING_STATUSES).toEqual(["MFJ", "Single", "HOH"]);
    expect(retirementFilingStatus(null, "QSS")).toBe("Single");
    expect(retirementFilingStatus("QSS", "MFJ")).toBe("Single");
    expect(retirementFilingStatus(null, "HOH")).toBe("HOH");
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

  it("parses the four statuses and nothing else", () => {
    expect(parseReturnFilingStatus("HOH")).toBe("HOH");
    expect(parseReturnFilingStatus("QSS")).toBe("QSS");
    expect(parseReturnFilingStatus("MFS")).toBeNull();
    expect(parseReturnFilingStatus(null)).toBeNull();
  });

  it("pairs the spouses only on a joint return of exactly two people", () => {
    expect(spousePair("MFJ", ["a", "b"])).toEqual(["a", "b"]);
    expect(spousePair("MFJ", ["a"])).toBeNull();
    expect(spousePair("MFJ", ["a", "b", "c"])).toBeNull();
    expect(spousePair("QSS", ["a", "b"])).toBeNull();
    expect(spousePair("Single", ["a", "b"])).toBeNull();
    expect(spousePair(null, ["a", "b"])).toBeNull();
  });
});
