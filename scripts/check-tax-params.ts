/**
 * Tax Parameter Staleness Checker
 *
 * Validates that the tax-data file is current for the active tax year. Runs as a CI check and on a monthly schedule (Oct-Jan) when
 * IRS/CMS/HHS publishes new data.
 *
 * Checks:
 *   1. tax-data/us-federal.json has rows for the expected tax year in every
 *      reference table (contribution_limits, tax_brackets, ltcg_brackets,
 *      irmaa_brackets, fpl_by_household).
 *   1b. tax_params vintage rows don't claim a year the actual value
 *       tables haven't been seeded for — catches "bumped tax_params to 2027
 *       but forgot to add the 2027 brackets."
 *
 * See TAX-PARAMETER-RUNBOOK.md for the full annual update procedure.
 *
 * Usage: pnpm check:tax-params
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { TAX_DATA_SECTIONS } from "../src/lib/config/tax-data-publication";
import {
  taxDataStatus,
  taxYearDeadline,
} from "../src/lib/pure/tax-data-status";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration: when each reference table is expected to be available
// ---------------------------------------------------------------------------

// Each table's publication date and the "should have it by now" rule are
// shared with the app's notice: lib/config/tax-data-publication.ts,
// lib/pure/tax-data-status.ts.

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

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

function run() {
  const now = new Date();
  const sql = readFile("tax-data/us-federal.json");

  console.log("Tax parameter staleness check\n");

  // --- Check 1: Seed file ---
  const seedChecks = checkSeedFile(sql, now);
  let seedWarnings = 0;
  let seedErrors = 0;

  console.log("=== Tax data (tax-data/us-federal.json) ===\n");

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
  const totalErrors = seedErrors + vintageChecks.length;
  console.log(`\n--- Summary ---`);
  console.log(`Seed:      ${seedErrors} error(s), ${seedWarnings} not-yet-due`);
  console.log(`Vintage:   ${vintageChecks.length} error(s)`);

  if (totalErrors > 0) {
    console.log(
      `\n${totalErrors} issue(s) found. See TAX-PARAMETER-RUNBOOK.md for update procedure.`,
    );
    process.exit(1);
  }

  console.log("\nAll tax parameters current. ✓");
}

run();
