/**
 * The retirement tables' column defaults stay literals in the schema (a
 * generator or migration per change isn't worth it); this keeps each one
 * equal to the config value the code falls back to.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns, type AnyColumn } from "drizzle-orm";
import {
  retirementScenarios,
  retirementSettings,
} from "@/lib/db/pg/retirement";
import { retirementSettings as sqliteRetirementSettings } from "@/lib/db/sqlite/retirement";
import { strategyParamFields } from "@/lib/config/withdrawal-strategies";
import {
  DEFAULT_ROTH_BRACKET_TARGET,
  DEFAULT_TAX_RATE_BROKERAGE,
} from "@/lib/constants";

function columnDefault(column: AnyColumn): unknown {
  const value: unknown = column.default;
  return typeof value === "string" ? Number(value) : value;
}

describe("retirement schema defaults", () => {
  const columns: Record<string, AnyColumn> =
    getTableColumns(retirementSettings);

  it.each(strategyParamFields().map((f) => [f.column, f] as const))(
    "%s defaults to its strategy config value",
    (column, field) => {
      const col = columns[column];
      expect(col, `no retirement_settings column ${column}`).toBeDefined();
      if ("nullable" in field && field.nullable) return;
      expect(columnDefault(col!)).toBe(field.default);
    },
  );

  it("the Roth bracket target defaults to DEFAULT_ROTH_BRACKET_TARGET", () => {
    for (const table of [retirementSettings, sqliteRetirementSettings])
      expect(columnDefault(table.rothBracketTarget)).toBe(
        DEFAULT_ROTH_BRACKET_TARGET,
      );
  });

  it("a scenario's brokerage rate defaults to DEFAULT_TAX_RATE_BROKERAGE", () => {
    expect(
      columnDefault(retirementScenarios.distributionTaxRateBrokerage),
    ).toBe(DEFAULT_TAX_RATE_BROKERAGE);
  });
});
