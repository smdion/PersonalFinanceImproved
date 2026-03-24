/**
 * CLI tool: Export all versioned table data to a JSON backup file.
 *
 * Usage:
 *   pnpm backup:export                    # Write to stdout
 *   pnpm backup:export --out ./backup.json  # Write to file
 */

import * as fs from "fs";
import * as path from "path";

function getDialect(): "postgresql" | "sqlite" {
  const url = process.env.DATABASE_URL;
  if (
    url &&
    (url.startsWith("postgres://") || url.startsWith("postgresql://"))
  ) {
    return "postgresql";
  }
  return "sqlite";
}

function readSchemaVersion(): string {
  try {
    const dialect = getDialect();
    const journalDir = dialect === "postgresql" ? "drizzle" : "drizzle-sqlite";
    const journalPath = path.join(
      process.cwd(),
      journalDir,
      "meta",
      "_journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
    const entries = journal.entries;
    return entries?.[entries.length - 1]?.tag ?? "unknown";
  } catch {
    return "unknown";
  }
}

// Table names matching version-tables.ts
const VERSION_TABLE_NAMES = [
  "people",
  "budget_profiles",
  "savings_goals",
  "mortgage_loans",
  "contribution_limits",
  "retirement_scenarios",
  "return_rate_table",
  "tax_brackets",
  "ltcg_brackets",
  "irmaa_brackets",
  "api_connections",
  "app_settings",
  "local_admins",
  "scenarios",
  "asset_class_params",
  "mc_presets",
  "portfolio_snapshots",
  "brokerage_goals",
  "contribution_profiles",
  "net_worth_annual",
  "home_improvement_items",
  "other_asset_items",
  "historical_notes",
  "relocation_scenarios",
  "jobs",
  "budget_items",
  "savings_monthly",
  "savings_planned_transactions",
  "savings_allocation_overrides",
  "self_loans",
  "performance_accounts",
  "mortgage_what_if_scenarios",
  "mortgage_extra_payments",
  "retirement_settings",
  "retirement_salary_overrides",
  "retirement_budget_overrides",
  "asset_class_correlations",
  "glide_path_allocations",
  "brokerage_planned_transactions",
  "annual_performance",
  "property_taxes",
  "salary_changes",
  "paycheck_deductions",
  "contribution_accounts",
  "portfolio_accounts",
  "account_performance",
  "mc_preset_glide_paths",
  "mc_preset_return_overrides",
];

async function exportPostgres(): Promise<Record<string, unknown[]>> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : false,
  });

  const tables: Record<string, unknown[]> = {};
  const client = await pool.connect();
  try {
    for (const tableName of VERSION_TABLE_NAMES) {
      try {
        const { rows } = await client.query(`SELECT * FROM "${tableName}"`);
        tables[tableName] = rows;
      } catch {
        tables[tableName] = [];
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  return tables;
}

function exportSqlite(): Record<string, unknown[]> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Database = require("better-sqlite3");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const dbPath = process.env.SQLITE_PATH ?? "data/ledgr.db";
  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("journal_mode = WAL");

  const tables: Record<string, unknown[]> = {};
  for (const tableName of VERSION_TABLE_NAMES) {
    try {
      tables[tableName] = sqlite.prepare(`SELECT * FROM "${tableName}"`).all();
    } catch {
      tables[tableName] = [];
    }
  }

  sqlite.close();
  return tables;
}

async function run() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

  const dialect = getDialect();
  const schemaVersion = readSchemaVersion();

  console.error(
    `Exporting backup (dialect: ${dialect}, schema: ${schemaVersion})...`,
  );

  const tables =
    dialect === "postgresql" ? await exportPostgres() : exportSqlite();

  const backup = {
    schemaVersion,
    exportedAt: new Date().toISOString(),
    tables,
  };

  const json = JSON.stringify(backup);

  if (outPath) {
    fs.writeFileSync(outPath, json);
    const totalRows = Object.values(tables).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    console.error(
      `Backup written to ${outPath} (${Object.keys(tables).length} tables, ${totalRows} rows)`,
    );
  } else {
    process.stdout.write(json);
  }
}

run().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
