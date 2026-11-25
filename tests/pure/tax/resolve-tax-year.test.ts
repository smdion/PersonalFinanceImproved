/**
 * resolveTaxYear reads a stored withholding table the engine prices tax on:
 * a negative rate (a hand-edited table) reads as 0% with a note, and the
 * stored rows are kept as they are.
 */
import { describe, expect, it } from "vitest";
import {
  taxDataBrackets,
  taxDataLimits,
  taxDataWithholding,
} from "../../helpers/tax-data";
import { resolveTaxYear } from "@/lib/pure/tax/resolve-tax-year";
import type { TaxParamsRowSets } from "@/lib/pure/tax/resolve-tax-params";

function resolve(withholding: TaxParamsRowSets["withholdingBrackets"]) {
  const years = [...new Set(withholding.map((r) => r.taxYear))];
  return resolveTaxYear(
    "MFJ",
    [],
    null,
    years.map((taxYear) => ({ taxYear, version: 1 })),
    taxDataLimits(),
    withholding,
    taxDataBrackets("ltcg") as TaxParamsRowSets["ltcgBrackets"],
    taxDataBrackets("irmaa") as TaxParamsRowSets["irmaaBrackets"],
    years.map((taxYear) => ({ taxYear, amounts: { "1": 15650, "2": 21150 } })),
  );
}

describe("resolveTaxYear — withholding table rates", () => {
  it("passes a valid table through unchanged, with no note", () => {
    const { bracketData, rateNotes } = resolve(taxDataWithholding());
    expect(bracketData.every((b) => b.rate >= 0)).toBe(true);
    expect(rateNotes).toEqual([]);
  });

  it("reads a negative rate as 0% with a note, keeping the stored row", () => {
    const stored = taxDataWithholding().map((r) =>
      r.filingStatus === "MFJ" && !r.w4Checkbox
        ? {
            ...r,
            brackets: r.brackets.map((b, i) =>
              i === 1 ? { ...b, rate: -0.1 } : b,
            ),
          }
        : r,
    );
    const { bracketData, rateNotes, latestTaxYear } = resolve(stored);
    const storedTable = stored.find(
      (r) =>
        r.taxYear === latestTaxYear &&
        r.filingStatus === "MFJ" &&
        !r.w4Checkbox,
    )!.brackets;

    expect(bracketData[1]!.rate).toBe(0);
    expect(bracketData[1]!.threshold).toBe(storedTable[1]!.threshold);
    expect(bracketData[2]).toEqual(storedTable[2]);
    expect(storedTable[1]!.rate).toBe(-0.1);
    expect(rateNotes).toHaveLength(1);
    expect(rateNotes[0]).toContain("negative rate");
    expect(rateNotes[0]).toContain("Settings → Reference Data");
  });
});
