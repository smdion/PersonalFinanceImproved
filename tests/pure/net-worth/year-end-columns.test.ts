/**
 * A finalized year with no performance rows: its portfolio by type from the
 * year-end columns, keyed through the display groups in config.
 */
import { describe, it, expect } from "vitest";
import { storedPortfolioByType } from "@/lib/pure/net-worth/year-end-columns";

const row = {
  retirementTotal: "700.10",
  hsa: "100",
  ltBrokerage: "200",
  espp: "50.25",
  rBrokerage: null,
};

describe("storedPortfolioByType", () => {
  it("reads each display group's columns under its first category", () => {
    expect(storedPortfolioByType(row)).toEqual({
      "401k": 700.1,
      hsa: 100,
      brokerage: 250.25,
    });
  });

  it("keeps the order the hand-written keys had", () => {
    expect(Object.keys(storedPortfolioByType(row))).toEqual([
      "401k",
      "hsa",
      "brokerage",
    ]);
  });
});
