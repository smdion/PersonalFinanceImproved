/**
 * Unit tests for the utilities importer's pure parse function.
 *
 * Covers month-label mapping (including the sheet's label drift), the cost-only
 * / empty / usage-only cell quirks, decimal formatting, and the loud-failure
 * paths (missing provider, unrecognized month label).
 */
import { describe, it, expect } from "vitest";
import {
  parseUtilityMatrix,
  MONTH_LABEL_MAP,
  USAGE_UNIT_BY_KIND,
} from "../../scripts/import-utilities";

// Matrix layout mirrors the sheet: A=provider, C(=idx2)=first year (cost),
// D(=idx3)=its usage, E(=idx4)=next year, etc. Row 2 (idx1) is blank; month
// rows start at row 3 (idx2).
function matrix(
  rows: { label: unknown; cells: unknown[] }[],
  years: number[] = [2018],
): unknown[][] {
  const header: unknown[] = ["Atmos", null];
  for (const y of years) header.push(y, null); // cost col, usage col
  const out: unknown[][] = [header, []]; // header + blank row 2
  for (const r of rows) out.push([r.label, null, ...r.cells]);
  return out;
}

describe("parseUtilityMatrix", () => {
  it("maps month labels (incl. drift: April/June/July/Sept) to numbers", () => {
    const m = matrix([
      { label: "Jan", cells: [10, 1] },
      { label: "April", cells: [40, 4] },
      { label: "June", cells: [60, 6] },
      { label: "July", cells: [70, 7] },
      { label: "Sept", cells: [90, 9] },
      { label: "Dec", cells: [120, 12] },
    ]);
    const { rows } = parseUtilityMatrix(m, "gas");
    expect(rows.map((r) => r.month)).toEqual([1, 4, 6, 7, 9, 12]);
  });

  it("reads the provider from cell A1", () => {
    const m = matrix([{ label: "Jan", cells: [10, 1] }]);
    expect(parseUtilityMatrix(m, "gas").providerName).toBe("Atmos");
  });

  it("formats cost to 2 and usage to 4 decimal places", () => {
    const m = matrix([{ label: "Jan", cells: [115.2, 134] }]);
    const { rows } = parseUtilityMatrix(m, "gas");
    expect(rows[0]).toMatchObject({
      year: 2018,
      month: 1,
      cost: "115.20",
      usage: "134.0000",
    });
  });

  it("stores usage null for a cost-only cell (2018 move-in quirk)", () => {
    const m = matrix([{ label: "April", cells: [36.04, null] }]);
    const { rows, warnings } = parseUtilityMatrix(m, "gas");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cost: "36.04", usage: null });
    expect(warnings).toHaveLength(0);
  });

  it("skips an entirely empty cell pair", () => {
    const m = matrix([
      { label: "Jan", cells: [null, null] },
      { label: "Feb", cells: [50, 5] },
    ]);
    const { rows } = parseUtilityMatrix(m, "gas");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.month).toBe(2);
  });

  it("warns and skips a usage-only cell (usage without cost)", () => {
    const m = matrix([{ label: "Jan", cells: [null, 99] }]);
    const { rows, warnings } = parseUtilityMatrix(m, "gas");
    expect(rows).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/usage present but no cost/);
  });

  it("handles multiple year columns in one row", () => {
    const m = matrix(
      [{ label: "Jan", cells: [100, 10, 200, 20] }],
      [2018, 2019],
    );
    const { rows } = parseUtilityMatrix(m, "gas");
    expect(rows).toEqual([
      { year: 2018, month: 1, cost: "100.00", usage: "10.0000" },
      { year: 2019, month: 1, cost: "200.00", usage: "20.0000" },
    ]);
  });

  it("stops at the first blank label row (ignores the derived block)", () => {
    const m = matrix([{ label: "Jan", cells: [10, 1] }]);
    m.push([null, null, 999, 999]); // blank label — boundary
    m.push(["Avg", null, 123, 45]); // derived summary row — must be ignored
    const { rows } = parseUtilityMatrix(m, "gas");
    expect(rows).toHaveLength(1);
  });

  it("throws on an unrecognized month label", () => {
    const m = matrix([{ label: "Smarch", cells: [10, 1] }]);
    expect(() => parseUtilityMatrix(m, "gas")).toThrow(/unrecognized month/i);
  });

  it("throws when the provider (A1) is missing", () => {
    const m = matrix([{ label: "Jan", cells: [10, 1] }]);
    m[0]![0] = null; // wipe provider
    expect(() => parseUtilityMatrix(m, "gas")).toThrow(/provider/i);
  });

  it("exposes the expected month map and unit seeds", () => {
    expect(MONTH_LABEL_MAP["sept"]).toBe(9);
    expect(MONTH_LABEL_MAP["apr"]).toBe(4);
    expect(USAGE_UNIT_BY_KIND).toEqual({
      gas: "ccf",
      water: "gallon",
      electric: "kWh",
    });
  });
});
