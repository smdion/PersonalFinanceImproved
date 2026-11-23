import { describe, expect, it } from "vitest";
import {
  bookedTaxType,
  taxTypesHeldBy,
} from "@/lib/config/tax-treatment-buckets";
import { getAllCategories } from "@/lib/config/account-types";
import { PORTFOLIO_TAX_TYPE_VALUES } from "@/lib/config/enum-values";

describe("bookedTaxType", () => {
  it("a Roth-capable account's row is Roth only when stored tax-free", () => {
    expect(bookedTaxType("401k", "taxFree")).toBe("taxFree");
    expect(bookedTaxType("401k", "afterTax")).toBe("preTax");
    expect(bookedTaxType("ira", "hsa")).toBe("preTax");
    expect(bookedTaxType("ira", "not-a-tax-type")).toBe("preTax");
  });

  it("any other account's row is its one tax bucket", () => {
    expect(bookedTaxType("hsa", "taxFree")).toBe("hsa");
    expect(bookedTaxType("brokerage", "preTax")).toBe("afterTax");
  });

  it("an account type this version doesn't know counts its row as stored", () => {
    expect(bookedTaxType("pension", "afterTax")).toBe("afterTax");
    expect(bookedTaxType("pension", "preTax")).toBe("preTax");
  });
});

describe("taxTypesHeldBy", () => {
  it("lists the tax types each account type counts a row as", () => {
    expect(taxTypesHeldBy("401k")).toEqual(["preTax", "taxFree"]);
    expect(taxTypesHeldBy("hsa")).toEqual(["hsa"]);
    expect(taxTypesHeldBy("brokerage")).toEqual(["afterTax"]);
  });

  it("every listed tax type books to itself, and every account type holds one", () => {
    for (const category of getAllCategories()) {
      const held = taxTypesHeldBy(category);
      expect(held.length).toBeGreaterThan(0);
      for (const taxType of held)
        expect(bookedTaxType(category, taxType)).toBe(taxType);
    }
  });

  it("an account type this version doesn't know takes any", () => {
    expect(taxTypesHeldBy("pension")).toEqual([...PORTFOLIO_TAX_TYPE_VALUES]);
  });
});
