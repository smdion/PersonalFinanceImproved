/**
 * Tax Parameter Staleness Checker
 *
 * Validates that seed data and code fallbacks are current for the active tax
 * year. Runs as a CI check and on a monthly schedule (Oct-Jan) when
 * IRS/CMS/HHS publishes new data.
 *
 * Checks:
 *   1. seed-reference-data.sql has rows for the expected tax year in every
 *      reference table (contribution_limits, tax_brackets, ltcg_brackets,
 *      irmaa_brackets, fpl_by_household).
 *   1b. tax_params vintage rows (R43) don't claim a year the actual value
 *       tables haven't been seeded for — catches "bumped tax_params to 2027
 *       but forgot to add the 2027 brackets."
 *   2. Code fallback constants (irmaa-tables.ts's IRMAA_DATA_YEAR,
 *      aca-tables.ts's FPL_COVERAGE_YEAR, tax-tables.ts's LTCG_BRACKETS)
 *      are in sync with the latest seed data — read via real `import`s of
 *      the config modules, not comment-text scraping (R43 C10: the old
 *      comment-regex approach silently returned "?" for aca-tables.ts, and
 *      a stale/reworded comment could drift from the real exported value
 *      with nothing to catch it).
 *
 * See TAX-PARAMETER-RUNBOOK.md for the full annual update procedure.
 *
 * Usage: pnpm check:tax-params
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { IRMAA_DATA_YEAR } from "../src/lib/config/irmaa-tables";
import { FPL_COVERAGE_YEAR } from "../src/lib/config/aca-tables";
import { LTCG_BRACKETS } from "../src/lib/config/tax-tables";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration: when each reference table is expected to be available
// ---------------------------------------------------------------------------

/**
 * Cutoff date (month, day) after which each table should have a row for the
 * next tax year. Mid-month dates avoid false failures on the 1st when
 * IRS/CMS/HHS data may not yet be published.
 */
const EXPECTED_AVAILABILITY: Record<string, { month: number; day: number }> = {
  contribution_limits: { month: 10, day: 15 }, // Mid-October — IRS Rev. Proc.
  tax_brackets: { month: 10, day: 15 }, // Mid-October — IRS Pub 15-T
  ltcg_brackets: { month: 10, day: 15 }, // Mid-October — IRS Rev. Proc.
  irmaa_brackets: { month: 11, day: 15 }, // Mid-November — CMS announcement
  fpl_by_household: { month: 1, day: 15 }, // Mid-January — HHS Federal Register
};

// tax_params (R43) has no availability cutoff of its own — it's a vintage
// marker, not a figure. It's checked against the other tables' max years
// instead (check 1b below).

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentTaxYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  // After October 15, next year's data should be seeded for the *next* tax year.
  // Uses the earliest cutoff date to determine the tax year boundary.
  return month > 10 || (month === 10 && now.getDate() >= 15) ? year + 1 : year;
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

/** Every `tax_year` value found in `table`'s INSERT block in the seed. */
function seedYearsForTable(sql: string, table: string): number[] {
  const pattern = new RegExp(`INSERT INTO ${table}[\\s\\S]*?ON CONFLICT`, "g");
  const match = pattern.exec(sql);
  if (!match) return [];
  const years: number[] = [];
  const yearPattern = /\((\d{4}),\s/g;
  let m: RegExpExecArray | null;
  while ((m = yearPattern.exec(match[0])) !== null) {
    years.push(parseInt(m[1]!, 10));
  }
  return years;
}

// ---------------------------------------------------------------------------
// Check 1: seed file has rows for the expected tax year, per table
// ---------------------------------------------------------------------------

interface SeedCheck {
  table: string;
  expectedYear: number;
  found: boolean;
  maxYear: number;
  cutoff: { month: number; day: number };
}

function checkSeedFile(sql: string, expectedTaxYear: number): SeedCheck[] {
  return Object.entries(EXPECTED_AVAILABILITY).map(([table, cutoff]) => {
    const years = seedYearsForTable(sql, table);
    return {
      table,
      expectedYear: expectedTaxYear,
      found: years.includes(expectedTaxYear),
      maxYear: years.length > 0 ? Math.max(...years) : 0,
      cutoff,
    };
  });
}

// ---------------------------------------------------------------------------
// Check 1b (R43): tax_params vintage rows shouldn't outrun the real data
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
// Check 2: code fallbacks are in sync with the latest seed data — via real
// imports of the config modules, not comment-text scraping.
// ---------------------------------------------------------------------------

interface FallbackCheck {
  file: string;
  label: string;
  ok: boolean;
  detail: string;
}

function checkCodeFallbacks(sql: string): FallbackCheck[] {
  const results: FallbackCheck[] = [];

  // irmaa-tables.ts: IRMAA_DATA_YEAR must equal the seed's latest
  // irmaa_brackets year.
  const irmaaSeedMax = Math.max(0, ...seedYearsForTable(sql, "irmaa_brackets"));
  results.push({
    file: "src/lib/config/irmaa-tables.ts",
    label: "IRMAA_DATA_YEAR",
    ok: IRMAA_DATA_YEAR === irmaaSeedMax,
    detail: `code=${IRMAA_DATA_YEAR}, seed max=${irmaaSeedMax}`,
  });

  // aca-tables.ts: FPL_COVERAGE_YEAR must equal the seed's latest
  // fpl_by_household year.
  const fplSeedMax = Math.max(0, ...seedYearsForTable(sql, "fpl_by_household"));
  results.push({
    file: "src/lib/config/aca-tables.ts",
    label: "FPL_COVERAGE_YEAR",
    ok: FPL_COVERAGE_YEAR === fplSeedMax,
    detail: `code=${FPL_COVERAGE_YEAR}, seed max=${fplSeedMax}`,
  });

  // tax-tables.ts: LTCG_BRACKETS should match the seed's latest ltcg_brackets
  // year's values exactly (a value comparison, not a year comparison — more
  // precise, and doesn't depend on a parseable header comment).
  const ltcgYears = seedYearsForTable(sql, "ltcg_brackets");
  const ltcgSeedMax = ltcgYears.length > 0 ? Math.max(...ltcgYears) : 0;
  // Scope the row regex to JUST the ltcg_brackets INSERT block — irmaa_brackets
  // rows have the identical (year, 'status', '[...]') shape, and running this
  // against the whole file would let a later irmaa_brackets match silently
  // overwrite the ltcg capture.
  const ltcgBlockMatch = /INSERT INTO ltcg_brackets[\s\S]*?ON CONFLICT/.exec(
    sql,
  );
  const ltcgRowRe = /\((\d{4}), '(MFJ|Single|HOH)', '(\[[^']*\])'\)/g;
  const seedLtcgLatest: Record<string, unknown> = {};
  let m: RegExpExecArray | null;
  if (ltcgBlockMatch) {
    while ((m = ltcgRowRe.exec(ltcgBlockMatch[0])) !== null) {
      if (Number(m[1]) !== ltcgSeedMax) continue;
      seedLtcgLatest[m[2]!] = JSON.parse(m[3]!);
    }
  }
  const ltcgMatches =
    JSON.stringify(LTCG_BRACKETS.MFJ) === JSON.stringify(seedLtcgLatest.MFJ) &&
    JSON.stringify(LTCG_BRACKETS.Single) ===
      JSON.stringify(seedLtcgLatest.Single) &&
    JSON.stringify(LTCG_BRACKETS.HOH) === JSON.stringify(seedLtcgLatest.HOH);
  results.push({
    file: "src/lib/config/tax-tables.ts",
    label: "LTCG_BRACKETS",
    ok: ltcgMatches,
    detail: ltcgMatches
      ? `matches seed ${ltcgSeedMax}`
      : `does not match seed ${ltcgSeedMax} values`,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  const expectedTaxYear = getCurrentTaxYear();
  const sql = readFile("seed-reference-data.sql");

  console.log(
    `Tax parameter staleness check (expected tax year: ${expectedTaxYear})\n`,
  );

  // --- Check 1: Seed file ---
  const seedChecks = checkSeedFile(sql, expectedTaxYear);
  let seedWarnings = 0;
  let seedErrors = 0;

  console.log("=== Seed Data (seed-reference-data.sql) ===\n");

  const now = new Date();
  for (const check of seedChecks) {
    const cutoffDate = new Date(
      now.getFullYear(),
      check.cutoff.month - 1,
      check.cutoff.day,
    );
    const isPastDeadline = now >= cutoffDate;

    if (check.found) {
      console.log(
        `  ✓ ${check.table}: ${check.expectedYear} data present (max year: ${check.maxYear})`,
      );
    } else if (isPastDeadline) {
      console.log(
        `  ✗ ${check.table}: MISSING ${check.expectedYear} data (max year: ${check.maxYear}, expected after ${check.cutoff.month}/${check.cutoff.day})`,
      );
      seedErrors++;
    } else {
      console.log(
        `  ○ ${check.table}: ${check.expectedYear} data not yet expected (available after ${check.cutoff.month}/${check.cutoff.day}, max year: ${check.maxYear})`,
      );
      seedWarnings++;
    }
  }

  // --- Check 1b: tax_params vintage rows ---
  const vintageChecks = checkTaxParamsVintage(sql);
  console.log("\n=== tax_params Vintage Rows (R43) ===\n");
  if (vintageChecks.length === 0) {
    console.log("  ✓ every tax_params year is backed by real reference data");
  } else {
    for (const c of vintageChecks) {
      console.log(
        `  ✗ tax_params has a ${c.year} row, but ${c.behindTables.join(", ")} ${c.behindTables.length > 1 ? "have" : "has"} no ${c.year} data`,
      );
    }
  }

  // --- Check 2: Code fallbacks ---
  const fallbackChecks = checkCodeFallbacks(sql);
  let fallbackErrors = 0;

  console.log("\n=== Code Fallback Sync ===\n");

  for (const check of fallbackChecks) {
    if (check.ok) {
      console.log(`  ✓ ${check.file}: ${check.label} — ${check.detail}`);
    } else {
      console.log(`  ✗ ${check.file}: ${check.label} — ${check.detail}`);
      fallbackErrors++;
    }
  }

  // --- Summary ---
  const totalErrors = seedErrors + vintageChecks.length + fallbackErrors;
  console.log(`\n--- Summary ---`);
  console.log(`Seed:      ${seedErrors} error(s), ${seedWarnings} not-yet-due`);
  console.log(`Vintage:   ${vintageChecks.length} error(s)`);
  console.log(`Fallbacks: ${fallbackErrors} error(s)`);

  if (totalErrors > 0) {
    console.log(
      `\n${totalErrors} issue(s) found. See TAX-PARAMETER-RUNBOOK.md for update procedure.`,
    );
    process.exit(1);
  }

  console.log("\nAll tax parameters current. ✓");
}

run();
