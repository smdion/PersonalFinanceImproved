/**
 * The closed-set table and the check an import or restore runs with it.
 *
 * The walk: every text column the schema types by a union (its `$type`) is
 * listed in UNION_TYPED below, and the type check fails on one that isn't.
 * Each listed column of a versioned table must be in closedSetColumns().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as pgSchema from "@/lib/db/schema-pg";
import { VERSION_TABLE_NAMES } from "@/lib/db/backup/version-tables";
import {
  ClosedSetRefusal,
  closedSetColumns,
  checkImportedValues,
  checkRestoredValues,
} from "@/lib/db/backup/closed-set-columns";
import { STRATEGY_CONFIG_BY_STORED_KEY } from "@/lib/config/stored-withdrawal-strategy";
import { VERSION_PREVIEW_WITHHELD_TABLES } from "@/lib/db/backup/version-tables";
import { log } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({ log: vi.fn(), logWarnOnce: vi.fn() }));

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

  it("defaults only where the default keeps the row's meaning, each to a value in its set", () => {
    const defaulted = CLOSED_SET_COLUMNS.filter((c) => c.takesDefault !== null);
    expect(
      defaulted.map((c) => `${c.table}.${c.column}=${c.takesDefault}`),
    ).toEqual([
      "retirement_settings.withdrawal_strategy=fixed",
      "retirement_settings.withdrawal_routing_mode=bracket_filling",
      "savings_goals.target_mode=fixed",
      "contribution_accounts.parent_category=Retirement",
      "portfolio_accounts.parent_category=Retirement",
      "tax_brackets.origin=user",
      "ltcg_brackets.origin=user",
      "irmaa_brackets.origin=user",
      "contribution_limits.origin=user",
      "fpl_by_household.origin=user",
      "budget_items.api_sync_direction=pull",
    ]);
    for (const c of defaulted) expect(c.values).toContain(c.takesDefault);
  });

  it("checks no table that holds credentials", () => {
    for (const c of CLOSED_SET_COLUMNS)
      expect(VERSION_PREVIEW_WITHHELD_TABLES).not.toContain(c.table);
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

describe("checkImportedValues and checkRestoredValues", () => {
  beforeEach(() => vi.mocked(log).mockClear());

  it("returns a valid backup's tables as the same arrays, with no notes", () => {
    const tables = {
      retirement_settings: [settingsRow("guyton_klinger")],
      contribution_accounts: [
        { ...accountRow("401k"), hsa_coverage_type: null },
      ],
      people: [{ id: 1, name: "Robin" }],
    };
    const out = checkImportedValues(tables);
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
    const out = checkImportedValues({ retirement_settings: rows });
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
    const out = checkImportedValues({
      retirement_settings: [settingsRow(value)],
    });
    expect(out.tables.retirement_settings).toEqual([settingsRow("fixed")]);
    expect(out.valueNotes[0]).toMatchObject({ value, defaultedTo: "fixed" });
  });

  it("leaves a row without the column to the insert (the schema default)", () => {
    const rows = [{ id: 1, person_id: 1 }];
    const out = checkImportedValues({ retirement_settings: rows });
    expect(out.tables.retirement_settings).toBe(rows);
    expect(out.valueNotes).toEqual([]);
  });

  it("takes null in a nullable column", () => {
    const rows = [{ id: 1, filing_status: null }];
    expect(
      checkImportedValues({ retirement_settings: rows }).valueNotes,
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
      checkImportedValues(tables);
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
      checkImportedValues({
        contribution_accounts: [{ id: 1, hsa_coverage_type: "family_plus" }],
      }),
    ).toThrow(ClosedSetRefusal);
  });
});

describe("the follow-up defaults and refusals", () => {
  beforeEach(() => vi.mocked(log).mockClear());

  it.each([
    ["tax_brackets", "origin", "verified", "user"],
    ["fpl_by_household", "origin", "Seed", "user"],
    ["budget_items", "api_sync_direction", "sideways", "pull"],
  ])(
    "%s.%s takes its default for %s, with a note",
    (table, column, value, to) => {
      const out = checkImportedValues({
        [table]: [{ id: 1, [column]: value }],
      });
      expect(out.tables[table]).toEqual([{ id: 1, [column]: to }]);
      expect(out.valueNotes).toEqual([
        { table, column, value, rows: 1, defaultedTo: to },
      ]);
    },
  );

  it.each([
    ["contribution_accounts", "employer_match_tax_treatment", "roth"],
    ["contribution_accounts", "ownership", "community"],
    ["performance_accounts", "retirement_behavior", "never"],
    ["performance_accounts", "contribution_scaling", "doubles"],
  ])("%s.%s still refuses %s", (table, column, value) => {
    expect(() =>
      checkImportedValues({ [table]: [{ id: 1, [column]: value }] }),
    ).toThrow(ClosedSetRefusal);
  });

  it("logs one line per defaulted value, with the original, and none for a valid backup", () => {
    checkRestoredValues({
      retirement_settings: [
        settingsRow("retired_strategy"),
        settingsRow("fixed"),
      ],
      tax_brackets: [
        { id: 1, origin: "verified" },
        { id: 2, origin: "verified" },
      ],
    });
    expect(vi.mocked(log).mock.calls).toEqual([
      [
        "warn",
        "backup_value_defaulted",
        {
          from: "restore",
          table: "retirement_settings",
          column: "withdrawal_strategy",
          value: '"retired_strategy"',
          defaultedTo: "fixed",
          rows: 1,
        },
      ],
      [
        "warn",
        "backup_value_defaulted",
        {
          from: "restore",
          table: "tax_brackets",
          column: "origin",
          value: '"verified"',
          defaultedTo: "user",
          rows: 2,
        },
      ],
    ]);
    vi.mocked(log).mockClear();
    checkImportedValues({ retirement_settings: [settingsRow("fixed")] });
    expect(log).not.toHaveBeenCalled();
  });

  it("a refused restore says to restore another version; a refused import, to correct the backup", () => {
    const tables = {
      performance_accounts: [{ id: 1, account_type: "solo401k" }],
    };
    expect(() => checkRestoredValues(tables)).toThrow(
      "Nothing was changed. Restore another version, or update Ledgr and try again.",
    );
    expect(() => checkRestoredValues(tables)).not.toThrow(/correct the backup/);
    expect(() => checkImportedValues(tables)).toThrow(
      "Nothing was changed. Update Ledgr, or correct the backup, and try again.",
    );
  });
});

describe("the stored-strategy lookup", () => {
  it("finds a current key and nothing for an Object member's name", () => {
    expect(STRATEGY_CONFIG_BY_STORED_KEY["fixed"]?.label).toBe("Fixed Real");
    for (const key of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ])
      expect(STRATEGY_CONFIG_BY_STORED_KEY[key]).toBeUndefined();
  });
});
