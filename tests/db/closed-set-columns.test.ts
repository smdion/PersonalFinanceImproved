/**
 * The closed-set table and the check an import or restore runs with it.
 *
 * The walk: every text column the schema types by a union (its `$type`) is
 * listed in UNION_TYPED below, and the type check fails on one that isn't.
 * Each listed column of a versioned table must be in closedSetColumns().
 */
import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as pgSchema from "@/lib/db/schema-pg";
import { VERSION_TABLE_NAMES } from "@/lib/db/version-tables";
import {
  ClosedSetRefusal,
  closedSetColumns,
  checkClosedSetValues,
} from "@/lib/db/closed-set-columns";

type Schema = typeof pgSchema;
type TableExport = {
  [N in keyof Schema]: Schema[N] extends PgTable ? N : never;
}[keyof Schema];
/** Keys whose select type is a string union narrower than `string`. */
type UnionKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends string
    ? string extends NonNullable<T[K]>
      ? never
      : K
    : never;
}[keyof T];
type UnionTypedColumn = {
  [N in TableExport]: `${N}.${UnionKeys<Schema[N]["$inferSelect"]> & string}`;
}[TableExport];

// A plain-text column is not union-typed (the walk tells them apart).
// @ts-expect-error -- account_type is stored as plain text
const plainText: UnionTypedColumn = "contributionAccounts.accountType";

/** Every union-typed text column: checked on import, or not in a backup. */
const UNION_TYPED: Record<UnionTypedColumn, "checked" | "not versioned"> = {
  "budgetApiCache.service": "not versioned",
  "taxDataUpdates.status": "not versioned",
  "securities.kind": "checked",
  "securities.factsBasis": "checked",
  "securityFacts.source": "checked",
  "holdingObservations.source": "checked",
  "holdingPeriods.basis": "checked",
  "investmentTransactions.kindOverride": "checked",
  "budgetItems.apiSyncDirection": "checked",
  "budgetItemCategoryLinks.service": "checked",
  "budgetItemCategoryLinks.syncDirection": "checked",
  "contributionAccounts.taxTreatment": "checked",
  "contributionAccounts.employerMatchType": "checked",
  "contributionAccounts.employerMatchTaxTreatment": "checked",
  "contributionAccounts.hsaCoverageType": "checked",
  "contributionAccounts.ownership": "checked",
  "contributionLimits.origin": "checked",
  "assetClassBuckets.bucket": "checked",
  "debts.kind": "checked",
  "utilityService.kind": "checked",
  "utilityService.usageUnit": "checked",
  "utilityReading.source": "checked",
  "performanceAccounts.ownershipType": "checked",
  "performanceAccounts.retirementBehavior": "checked",
  "performanceAccounts.contributionScaling": "checked",
  "portfolioAccounts.taxType": "checked",
  "retirementSettings.filingStatus": "checked",
  "savingsGoalCategoryLinks.service": "checked",
  "taxBrackets.filingStatus": "checked",
  "taxBrackets.origin": "checked",
  "ltcgBrackets.filingStatus": "checked",
  "ltcgBrackets.origin": "checked",
  "irmaaBrackets.filingStatus": "checked",
  "irmaaBrackets.origin": "checked",
  "fplByHousehold.origin": "checked",
};

/** Stored as plain text, but writers take only a config set. */
const UNTYPED_CHECKED = [
  "retirement_settings.withdrawal_strategy",
  "retirement_settings.withdrawal_routing_mode",
  "savings_goals.target_mode",
  "contribution_accounts.account_type",
  "performance_accounts.account_type",
  "portfolio_accounts.account_type",
  "contribution_accounts.parent_category",
  "portfolio_accounts.parent_category",
  "performance_accounts.parent_category",
  "account_performance.parent_category",
];

const CLOSED_SET_COLUMNS = closedSetColumns();
const listed = new Set(CLOSED_SET_COLUMNS.map((c) => `${c.table}.${c.column}`));

function sqlName(entry: string): { table: string; column: string } {
  const [exportName, key] = entry.split(".") as [TableExport, string];
  const table = pgSchema[exportName];
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return { table: getTableName(table), column: columns[key]!.name };
}

describe("the closed-set table", () => {
  it("holds every union-typed column of a versioned table", () => {
    expect(plainText).toBe("contributionAccounts.accountType");
    for (const [entry, kind] of Object.entries(UNION_TYPED)) {
      const { table, column } = sqlName(entry);
      if (kind === "not versioned") {
        expect(VERSION_TABLE_NAMES, entry).not.toContain(table);
      } else {
        expect(VERSION_TABLE_NAMES, entry).toContain(table);
        expect(listed, entry).toContain(`${table}.${column}`);
      }
    }
  });

  it("holds the plain-text columns that hold a config set, and nothing else", () => {
    const typed = Object.entries(UNION_TYPED)
      .filter(([, kind]) => kind === "checked")
      .map(([entry]) => sqlName(entry))
      .map(({ table, column }) => `${table}.${column}`);
    expect([...listed].sort()).toEqual([...typed, ...UNTYPED_CHECKED].sort());
  });

  it("defaults only the withdrawal strategy, routing mode, target mode and two parent categories, each to a value in its set", () => {
    const defaulted = CLOSED_SET_COLUMNS.filter((c) => c.takesDefault !== null);
    expect(
      defaulted.map((c) => `${c.table}.${c.column}=${c.takesDefault}`),
    ).toEqual([
      "retirement_settings.withdrawal_strategy=fixed",
      "retirement_settings.withdrawal_routing_mode=bracket_filling",
      "savings_goals.target_mode=fixed",
      "contribution_accounts.parent_category=Retirement",
      "portfolio_accounts.parent_category=Retirement",
    ]);
    for (const c of defaulted) expect(c.values).toContain(c.takesDefault);
  });

  it("has no column twice and no empty set", () => {
    expect(listed.size).toBe(CLOSED_SET_COLUMNS.length);
    for (const c of CLOSED_SET_COLUMNS)
      expect(c.values.length).toBeGreaterThan(0);
  });
});

const settingsRow = (withdrawalStrategy: unknown) => ({
  id: 1,
  person_id: 1,
  withdrawal_strategy: withdrawalStrategy,
});
const accountRow = (account_type: unknown) => ({
  id: 7,
  account_type,
  parent_category: "Retirement",
});

describe("checkClosedSetValues", () => {
  it("returns a valid backup's tables as the same arrays, with no notes", () => {
    const tables = {
      retirement_settings: [settingsRow("guyton_klinger")],
      contribution_accounts: [
        { ...accountRow("401k"), hsa_coverage_type: null },
      ],
      people: [{ id: 1, name: "Robin" }],
    };
    const out = checkClosedSetValues(tables);
    expect(out.valueNotes).toEqual([]);
    for (const [name, rows] of Object.entries(tables))
      expect(out.tables[name]).toBe(rows);
  });

  it("sets an unknown value in a column with a default to it, with a note per value", () => {
    const rows = [
      settingsRow("retired_strategy"),
      { ...settingsRow("retired_strategy"), id: 2 },
      { ...settingsRow("fixed"), id: 3 },
    ];
    const out = checkClosedSetValues({ retirement_settings: rows });
    expect(out.tables.retirement_settings).toEqual([
      settingsRow("fixed"),
      { ...settingsRow("fixed"), id: 2 },
      { ...settingsRow("fixed"), id: 3 },
    ]);
    expect(rows[0]!.withdrawal_strategy).toBe("retired_strategy");
    expect(out.valueNotes).toEqual([
      {
        table: "retirement_settings",
        column: "withdrawal_strategy",
        value: "retired_strategy",
        rows: 2,
        defaultedTo: "fixed",
      },
    ]);
  });

  it.each([
    ["case", "Fixed"],
    ["a trailing space", "fixed "],
    ["empty", ""],
    ["null in a NOT NULL column", null],
    ["a number", 3],
  ])("treats %s as outside the set", (_label, value) => {
    const out = checkClosedSetValues({
      retirement_settings: [settingsRow(value)],
    });
    expect(out.tables.retirement_settings).toEqual([settingsRow("fixed")]);
    expect(out.valueNotes[0]).toMatchObject({ value, defaultedTo: "fixed" });
  });

  it("leaves a row without the column to the insert (the schema default)", () => {
    const rows = [{ id: 1, person_id: 1 }];
    const out = checkClosedSetValues({ retirement_settings: rows });
    expect(out.tables.retirement_settings).toBe(rows);
    expect(out.valueNotes).toEqual([]);
  });

  it("takes null in a nullable column", () => {
    const rows = [{ id: 1, filing_status: null }];
    expect(
      checkClosedSetValues({ retirement_settings: rows }).valueNotes,
    ).toEqual([]);
  });

  it("refuses the whole backup over an unknown value in a column with no default, naming each", () => {
    const tables = {
      retirement_settings: [settingsRow("retired_strategy")],
      contribution_accounts: [accountRow("solo401k"), accountRow("solo401k")],
      performance_accounts: [{ id: 3, ownership_type: "Joint" }],
    };
    let thrown: unknown;
    try {
      checkClosedSetValues(tables);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClosedSetRefusal);
    const refusal = thrown as ClosedSetRefusal;
    expect(refusal.outside).toEqual([
      {
        table: "contribution_accounts",
        column: "account_type",
        value: "solo401k",
        rows: 2,
      },
      {
        table: "performance_accounts",
        column: "ownership_type",
        value: "Joint",
        rows: 1,
      },
    ]);
    expect(refusal.message).toContain(
      'contribution_accounts.account_type = "solo401k" (2 rows)',
    );
    expect(refusal.message).toContain(
      'performance_accounts.ownership_type = "Joint" (1 row)',
    );
    expect(refusal.message).toContain("Nothing was changed.");
  });

  it("refuses an unknown value in a nullable column with no default", () => {
    expect(() =>
      checkClosedSetValues({
        contribution_accounts: [{ id: 1, hsa_coverage_type: "family_plus" }],
      }),
    ).toThrow(ClosedSetRefusal);
  });
});
