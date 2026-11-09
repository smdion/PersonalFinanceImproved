/**
 * Tax Parameter Staleness Checker
 *
 * Validates that the tax-data file is current for the active tax year. Runs as a CI check and on a monthly schedule (Oct-Jan) when
 * IRS/CMS/HHS publishes new data.
 *
 * Checks:
 *   1. the tax data (tax-data/us-federal/) has rows for the expected tax year in every
 *      reference table (contribution_limits, tax_brackets, ltcg_brackets,
 *      irmaa_brackets, fpl_by_household).
 *   1b. tax_params vintage rows don't claim a year the actual value
 *       tables haven't been seeded for — catches "bumped tax_params to 2027
 *       but forgot to add the 2027 brackets."
 *
 * Check 1 reads the clock. With `--base <ref>` (CI on a push or pull
 * request) a missing year blocks only when the change touches the tax data
 * or the tables and rules that read it (TAX_PATHS); otherwise it warns, and
 * the weekly tax-data workflow (no --base) is what fails while it is stale.
 * Check 1b always blocks.
 *
 * See TAX-PARAMETER-RUNBOOK.md for the full annual update procedure.
 *
 * Usage: pnpm check:tax-params [--base <ref>]
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { TAX_DATA_SECTIONS } from "../src/lib/config/tax-data-publication";
import {
  TAX_DATA_DIR,
  readTaxDataDir,
} from "../src/lib/db/migrate/reference-reconcile-core";
import {
  taxDataStatus,
  taxYearDeadline,
} from "../src/lib/pure/tax/data-status";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration: when each reference table is expected to be available
// ---------------------------------------------------------------------------

// Each table's publication date and the "should have it by now" rule are
// shared with the app's notice: lib/config/tax-data-publication.ts,
// lib/pure/tax/data-status.ts.

type TaxDataFileJson = {
  years: Record<
    string,
    {
      limits?: Record<string, unknown>;
      withholding?: { tables?: Record<string, unknown> };
      ltcg?: { brackets?: Record<string, unknown> };
      irmaa?: { brackets?: Record<string, unknown> };
      fpl?: unknown;
    }
  >;
};

/** Every tax year the tax-data file has rows for in `table`. `data` is the
 *  file's text. */
function seedYearsForTable(data: string, table: string): number[] {
  const file = JSON.parse(data) as TaxDataFileJson;
  const has: Record<string, (y: TaxDataFileJson["years"][string]) => boolean> =
    {
      contribution_limits: (y) => Object.keys(y.limits ?? {}).length > 0,
      tax_brackets: (y) => Object.keys(y.withholding?.tables ?? {}).length > 0,
      ltcg_brackets: (y) => Object.keys(y.ltcg?.brackets ?? {}).length > 0,
      irmaa_brackets: (y) => Object.keys(y.irmaa?.brackets ?? {}).length > 0,
      fpl_by_household: (y) => y.fpl !== undefined,
      tax_params: () => true,
    };
  return Object.entries(file.years)
    .filter(([, y]) => has[table]?.(y))
    .map(([year]) => Number(year));
}

// ---------------------------------------------------------------------------
// Check 1: seed file has rows for the expected tax year, per table
// ---------------------------------------------------------------------------

interface SeedCheck {
  table: string;
  expectedYear: number;
  found: boolean;
  maxYear: number;
  nextDue: Date;
}

function checkSeedFile(sql: string, now: Date): SeedCheck[] {
  const yearsByTable = Object.fromEntries(
    TAX_DATA_SECTIONS.map((s) => [s.table, seedYearsForTable(sql, s.table)]),
  );
  return taxDataStatus({ yearsByTable }, now).sections.map((s) => ({
    table: s.table,
    expectedYear: s.expectedYear,
    found: !s.behind,
    maxYear: s.newestYear ?? 0,
    nextDue: taxYearDeadline(s.expectedYear + 1, s.due),
  }));
}

// ---------------------------------------------------------------------------
// Check 1b: tax_params vintage rows shouldn't outrun the real data
// ---------------------------------------------------------------------------

interface VintageCheck {
  year: number;
  behindTables: string[];
}

/** The evergreen value tables every tax_params year must be backed by. */
const VINTAGE_BACKING_TABLES = ["contribution_limits", "tax_brackets"];

function checkTaxParamsVintage(sql: string): VintageCheck[] {
  const vintageYears = seedYearsForTable(sql, "tax_params");
  return vintageYears
    .map((year) => {
      const behindTables = VINTAGE_BACKING_TABLES.filter(
        (table) => !seedYearsForTable(sql, table).includes(year),
      );
      return { year, behindTables };
    })
    .filter((c) => c.behindTables.length > 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** The tax data and the code that says which year is due. */
const TAX_PATHS = [
  "tax-data/",
  "src/lib/config/tax-tables.ts",
  "src/lib/config/tax-params.ts",
  "src/lib/pure/tax/resolve-tax-params.ts",
  "src/lib/config/tax-data-publication.ts",
  "src/lib/pure/tax/data-status.ts",
];

/** Files under TAX_PATHS that differ between `base` and the working tree. */
function taxFilesChanged(base: string): string[] {
  return execFileSync(
    "git",
    ["diff", "--name-only", base, "--", ...TAX_PATHS],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  )
    .split("\n")
    .filter(Boolean);
}

function run() {
  const now = new Date();
  const baseIdx = process.argv.indexOf("--base");
  const base = baseIdx === -1 ? undefined : process.argv[baseIdx + 1];
  if (baseIdx !== -1 && !base) {
    console.error("Usage: check-tax-params.ts [--base <ref>]");
    process.exit(2);
  }
  // The tax data, assembled into the one file every install reads.
  const sql = JSON.stringify(readTaxDataDir(fs, path.join(ROOT, TAX_DATA_DIR)));

  console.log("Tax parameter staleness check\n");

  // --- Check 1: Seed file ---
  const seedChecks = checkSeedFile(sql, now);
  let seedWarnings = 0;
  let seedErrors = 0;

  console.log(`=== Tax data (${TAX_DATA_DIR}) ===\n`);

  for (const check of seedChecks) {
    // The year after the expected one is the next to come due.
    const nextYear = check.expectedYear + 1;
    const nextDue = check.nextDue;

    if (check.found) {
      console.log(
        `  ✓ ${check.table}: ${check.expectedYear} data present (max year: ${check.maxYear})`,
      );
    } else {
      console.log(
        `  ✗ ${check.table}: MISSING ${check.expectedYear} data (max year: ${check.maxYear})`,
      );
      seedErrors++;
    }
    if (check.maxYear < nextYear) {
      console.log(
        `  ○ ${check.table}: ${nextYear} data due by ${nextDue.toLocaleDateString("en-CA")}`,
      );
      seedWarnings++;
    }
  }

  // --- Check 1b: tax_params vintage rows ---
  const vintageChecks = checkTaxParamsVintage(sql);
  console.log("\n=== tax_params Vintage Rows ===\n");
  if (vintageChecks.length === 0) {
    console.log("  ✓ every tax_params year is backed by real reference data");
  } else {
    for (const c of vintageChecks) {
      console.log(
        `  ✗ tax_params has a ${c.year} row, but ${c.behindTables.join(", ")} ${c.behindTables.length > 1 ? "have" : "has"} no ${c.year} data`,
      );
    }
  }

  // --- Summary ---
  const changed = base && seedErrors > 0 ? taxFilesChanged(base) : [];
  const seedBlocks = seedErrors > 0 && (!base || changed.length > 0);
  const totalErrors = (seedBlocks ? seedErrors : 0) + vintageChecks.length;
  console.log(`\n--- Summary ---`);
  console.log(`Seed:      ${seedErrors} error(s), ${seedWarnings} not-yet-due`);
  console.log(`Vintage:   ${vintageChecks.length} error(s)`);
  if (seedErrors > 0 && !seedBlocks)
    console.log(
      `\nWARNING: the tax data is behind, but nothing under ${TAX_PATHS.join(", ")} changed since ${base}, so this run doesn't block. The weekly tax-data workflow fails until it is updated.`,
    );
  else if (seedErrors > 0 && base)
    console.log(`\nBlocking: this change touches ${changed.join(", ")}.`);

  if (totalErrors > 0) {
    console.log(
      `\n${totalErrors} issue(s) found. See TAX-PARAMETER-RUNBOOK.md for update procedure.`,
    );
    process.exit(1);
  }

  console.log(
    seedErrors > 0
      ? "\nNo blocking tax-data issue."
      : "\nAll tax parameters current. ✓",
  );
}

run();
