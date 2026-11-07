/**
 * The text columns of the versioned tables that hold a value from a set the
 * config defines, and the check a restore or import runs on a backup's rows
 * once backup-transforms has brought them to today's schema.
 */
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import * as schema from "./schema-pg";
import { TAX_DATA_ORIGIN_VALUES } from "./reference-reconcile-core";
import { log } from "@/lib/logger";
import {
  getAllCategories,
  PARENT_CATEGORY_VALUES,
} from "@/lib/config/account-types";
import { BUDGET_API_SERVICE_VALUES } from "@/lib/config/budget-apps";
import {
  RETURN_FILING_STATUS_VALUES,
  W4_FILING_STATUS_VALUES,
} from "@/lib/config/filing-status";
import { WITHDRAWAL_STRATEGY_VALUES } from "@/lib/config/withdrawal-strategies";
import { WITHDRAWAL_ROUTING_MODES } from "@/lib/config/withdrawal-routing";
import {
  ACCOUNT_OWNERSHIP_VALUES,
  API_SYNC_DIRECTION_VALUES,
  COMPOSITION_BUCKET_VALUES,
  CONTRIBUTION_SCALING_VALUES,
  DEBT_KIND_VALUES,
  EMPLOYER_MATCH_TYPE_VALUES,
  FACTS_BASIS_VALUES,
  HOLDING_PERIOD_BASIS_VALUES,
  HOLDING_SOURCE_VALUES,
  HSA_COVERAGE_TYPE_VALUES,
  INVESTMENT_TRANSACTION_KIND_VALUES,
  MATCH_TAX_TREATMENT_VALUES,
  PORTFOLIO_TAX_TYPE_VALUES,
  RETIREMENT_BEHAVIOR_VALUES,
  SECURITY_FACT_SOURCE_VALUES,
  SECURITY_KIND_VALUES,
  TARGET_MODE_VALUES,
  TAX_TREATMENT_VALUES,
  UTILITY_KIND_VALUES,
  UTILITY_SOURCE_VALUES,
  UTILITY_UNIT_VALUES,
} from "@/lib/config/enum-values";

export type ClosedSetColumn = {
  table: string;
  column: string;
  values: readonly string[];
  nullable: boolean;
  /** The schema default a value outside the set takes, or null: refused. */
  takesDefault: string | null;
};

type SelectOf<T extends Table> = T["$inferSelect"];
type ColumnSets<T extends Table> = {
  [K in keyof SelectOf<T>]?: readonly NonNullable<SelectOf<T>[K]>[];
};

/** A table's closed-set columns. A value outside a set is refused, except
 *  in the `withDefault` columns, where it takes the schema default. */
function columnsOf<T extends Table>(
  table: T,
  sets: ColumnSets<T>,
  withDefault: (keyof ColumnSets<T>)[] = [],
): ClosedSetColumn[] {
  const columns = new Map(Object.entries(getTableColumns(table)));
  return Object.entries(sets).map(([key, values]) => {
    const column = columns.get(key)!;
    const name = `${getTableName(table)}.${column.name}`;
    const defaultValue =
      typeof column.default === "string" ? column.default : null;
    const defaults = withDefault.some((k) => k === key);
    if (defaults && defaultValue === null)
      throw new Error(`${name} has no default`);
    return {
      table: getTableName(table),
      column: column.name,
      values: [...(values ?? [])].map(String),
      nullable: !column.notNull,
      takesDefault: defaults ? defaultValue : null,
    };
  });
}

/** Every closed-set column of a versioned table, built from today's config.
 *  A value outside the set takes the default only in the columns whose
 *  default the owner named (where the default keeps the row's meaning). */
export function closedSetColumns(): ClosedSetColumn[] {
  const s = schema;
  const categories = getAllCategories();
  const parent = PARENT_CATEGORY_VALUES;
  const origin = TAX_DATA_ORIGIN_VALUES;
  const service = BUDGET_API_SERVICE_VALUES;
  return [
    ...columnsOf(
      s.retirementSettings,
      {
        withdrawalStrategy: WITHDRAWAL_STRATEGY_VALUES,
        withdrawalRoutingMode: WITHDRAWAL_ROUTING_MODES,
        filingStatus: RETURN_FILING_STATUS_VALUES,
      },
      ["withdrawalStrategy", "withdrawalRoutingMode"],
    ),
    ...columnsOf(s.savingsGoals, { targetMode: TARGET_MODE_VALUES }, [
      "targetMode",
    ]),
    ...columnsOf(
      s.contributionAccounts,
      {
        parentCategory: parent,
        accountType: categories,
        taxTreatment: TAX_TREATMENT_VALUES,
        employerMatchType: EMPLOYER_MATCH_TYPE_VALUES,
        employerMatchTaxTreatment: MATCH_TAX_TREATMENT_VALUES,
        hsaCoverageType: HSA_COVERAGE_TYPE_VALUES,
        ownership: ACCOUNT_OWNERSHIP_VALUES,
      },
      ["parentCategory"],
    ),
    ...columnsOf(
      s.portfolioAccounts,
      {
        parentCategory: parent,
        accountType: categories,
        taxType: PORTFOLIO_TAX_TYPE_VALUES,
      },
      ["parentCategory"],
    ),
    ...columnsOf(s.performanceAccounts, {
      parentCategory: parent,
      accountType: categories,
      ownershipType: ACCOUNT_OWNERSHIP_VALUES,
      retirementBehavior: RETIREMENT_BEHAVIOR_VALUES,
      contributionScaling: CONTRIBUTION_SCALING_VALUES,
    }),
    ...columnsOf(s.accountPerformance, { parentCategory: parent }),
    ...columnsOf(
      s.taxBrackets,
      { filingStatus: W4_FILING_STATUS_VALUES, origin },
      ["origin"],
    ),
    ...columnsOf(
      s.ltcgBrackets,
      { filingStatus: RETURN_FILING_STATUS_VALUES, origin },
      ["origin"],
    ),
    ...columnsOf(
      s.irmaaBrackets,
      { filingStatus: RETURN_FILING_STATUS_VALUES, origin },
      ["origin"],
    ),
    ...columnsOf(s.contributionLimits, { origin }, ["origin"]),
    ...columnsOf(s.fplByHousehold, { origin }, ["origin"]),
    ...columnsOf(
      s.budgetItems,
      { apiSyncDirection: API_SYNC_DIRECTION_VALUES },
      ["apiSyncDirection"],
    ),
    ...columnsOf(s.budgetItemCategoryLinks, {
      service,
      syncDirection: API_SYNC_DIRECTION_VALUES,
    }),
    ...columnsOf(s.savingsGoalCategoryLinks, { service }),
    ...columnsOf(s.debts, { kind: DEBT_KIND_VALUES }),
    ...columnsOf(s.utilityService, {
      kind: UTILITY_KIND_VALUES,
      usageUnit: UTILITY_UNIT_VALUES,
    }),
    ...columnsOf(s.utilityReading, { source: UTILITY_SOURCE_VALUES }),
    ...columnsOf(s.securities, {
      kind: SECURITY_KIND_VALUES,
      factsBasis: FACTS_BASIS_VALUES,
    }),
    ...columnsOf(s.securityFacts, { source: SECURITY_FACT_SOURCE_VALUES }),
    ...columnsOf(s.holdingObservations, { source: HOLDING_SOURCE_VALUES }),
    ...columnsOf(s.holdingPeriods, { basis: HOLDING_PERIOD_BASIS_VALUES }),
    ...columnsOf(s.investmentTransactions, {
      kindOverride: INVESTMENT_TRANSACTION_KIND_VALUES,
    }),
    ...columnsOf(s.assetClassBuckets, { bucket: COMPOSITION_BUCKET_VALUES }),
  ];
}

/** A backup value outside its set, and the rows that held it. */
export type OutsideValue = {
  table: string;
  column: string;
  value: unknown;
  rows: number;
};
/** A value an import or restore set to its column's default. */
export type ValueNote = OutsideValue & { defaultedTo: string };

/** Where the rows come from: a stored version, or an uploaded backup file. */
type BackupSource = "restore" | "import";

/** A backup holding values outside their sets in columns that refuse them.
 *  Thrown before anything is written. */
export class ClosedSetRefusal extends Error {
  constructor(
    readonly outside: OutsideValue[],
    from: BackupSource,
  ) {
    super(
      `This backup holds values this version of Ledgr doesn't have, in columns where no stand-in keeps their meaning: ${outside
        .map(
          (o) =>
            `${o.table}.${o.column} = ${JSON.stringify(o.value)} (${o.rows} ${o.rows === 1 ? "row" : "rows"})`,
        )
        .join(
          "; ",
        )}. Nothing was changed. ${from === "restore" ? "Restore another version, or update Ledgr and try again." : "Update Ledgr, or correct the backup, and try again."}`,
    );
    this.name = "ClosedSetRefusal";
  }
}

function isRow(row: unknown): row is Record<string, unknown> {
  return typeof row === "object" && row !== null;
}

function isAllowed(col: ClosedSetColumn, value: unknown): boolean {
  if (value === null) return col.nullable;
  return typeof value === "string" && col.values.includes(value);
}

/** Tallies one outside value under its column, by value. */
function tally<T extends OutsideValue>(
  found: Map<string, T>,
  col: ClosedSetColumn,
  value: unknown,
  first: T,
) {
  const key = `${col.table}\0${col.column}\0${JSON.stringify(value)}`;
  const seen = found.get(key);
  if (seen) seen.rows++;
  else found.set(key, first);
}

/** A backup's rows with each value outside a "default" column's set set to
 *  the default, and notes; one outside a "refuse" column's set throws
 *  ClosedSetRefusal. A row without the column is left to the insert. */
function checkClosedSetValues(
  tables: Record<string, unknown[]>,
  from: BackupSource,
): {
  tables: Record<string, unknown[]>;
  valueNotes: ValueNote[];
} {
  const all = closedSetColumns();
  const refused = new Map<string, OutsideValue>();
  const defaulted = new Map<string, ValueNote>();
  const out: Record<string, unknown[]> = { ...tables };
  for (const [table, rows] of Object.entries(tables)) {
    const cols = all.filter((c) => c.table === table);
    if (cols.length === 0) continue;
    let changed: unknown[] | null = null;
    for (const [i, record] of rows.entries()) {
      if (!isRow(record)) continue;
      let next: Record<string, unknown> | null = null;
      for (const col of cols) {
        if (!(col.column in record)) continue;
        const value = record[col.column];
        if (isAllowed(col, value)) continue;
        const outside = { table, column: col.column, value, rows: 1 };
        if (col.takesDefault === null) {
          tally(refused, col, value, outside);
          continue;
        }
        const defaultedTo = col.takesDefault;
        tally(defaulted, col, value, { ...outside, defaultedTo });
        next ??= { ...record };
        next[col.column] = defaultedTo;
      }
      if (next) (changed ??= [...rows])[i] = next;
    }
    if (changed) out[table] = changed;
  }
  if (refused.size > 0) throw new ClosedSetRefusal([...refused.values()], from);
  const valueNotes = [...defaulted.values()];
  // The original value is gone from the data once written: the log keeps it.
  for (const { table, column, value, rows, defaultedTo } of valueNotes)
    log("warn", "backup_value_defaulted", {
      from,
      table,
      column,
      value: JSON.stringify(value),
      defaultedTo,
      rows,
    });
  return { tables: out, valueNotes };
}

/** The check on a stored version's rows (a refusal says to restore another). */
export const checkRestoredValues = (tables: Record<string, unknown[]>) =>
  checkClosedSetValues(tables, "restore");

/** The check on an uploaded backup file's rows. */
export const checkImportedValues = (tables: Record<string, unknown[]>) =>
  checkClosedSetValues(tables, "import");
