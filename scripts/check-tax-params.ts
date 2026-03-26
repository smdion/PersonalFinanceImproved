/**
 * Tax Parameter Staleness Checker
 *
 * Validates that seed data and code fallbacks are current for the active tax year.
 * Runs as a CI check and on a monthly schedule (Oct–Jan) when IRS publishes new data.
 *
 * Checks:
 *   1. seed-reference-data.sql has rows for the expected tax year in all 4 tables
 *   2. Code fallback constants in tax-tables.ts, irmaa-tables.ts, aca-tables.ts
 *      reference the same year as the latest seed data
 *
 * See TAX-PARAMETER-RUNBOOK.md for the full annual update procedure.
 *
 * Usage: pnpm check:tax-params
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration: when each parameter set is expected to be available
// ---------------------------------------------------------------------------

/** Month (1-indexed) after which the current tax year's data should exist. */
const EXPECTED_AVAILABILITY: Record<string, number> = {
  contribution_limits: 10, // October — IRS Rev. Proc.
  tax_brackets: 10, // October — IRS Pub 15-T
  ltcg_brackets: 10, // October — IRS Rev. Proc.
  irmaa_brackets: 11, // November — CMS announcement
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCurrentTaxYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  // After October, next year's data should be seeded for the *next* tax year
  return month >= 10 ? year + 1 : year;
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
}

// ---------------------------------------------------------------------------
// Check 1: Seed file has rows for expected tax year
// ---------------------------------------------------------------------------

interface SeedCheck {
  table: string;
  expectedYear: number;
  found: boolean;
  maxYear: number;
  availableAfterMonth: number;
}

function checkSeedFile(expectedTaxYear: number): SeedCheck[] {
  const sql = readFile("seed-reference-data.sql");
  const results: SeedCheck[] = [];

  for (const [table, availMonth] of Object.entries(EXPECTED_AVAILABILITY)) {
    // Find all tax_year values for this table's INSERT
    const pattern = new RegExp(
      `INSERT INTO ${table}[\\s\\S]*?ON CONFLICT`,
      "g",
    );
    const match = pattern.exec(sql);

    let maxYear = 0;
    let foundExpected = false;

    if (match) {
      // Extract all year values from (YYYY, ...) tuples
      const yearPattern = /\((\d{4}),\s/g;
      let yearMatch;
      while ((yearMatch = yearPattern.exec(match[0])) !== null) {
        const year = parseInt(yearMatch[1]!, 10);
        if (year > maxYear) maxYear = year;
        if (year === expectedTaxYear) foundExpected = true;
      }
    }

    results.push({
      table,
      expectedYear: expectedTaxYear,
      found: foundExpected,
      maxYear,
      availableAfterMonth: availMonth,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Check 2: Code fallback year matches latest seed year
// ---------------------------------------------------------------------------

interface FallbackCheck {
  file: string;
  label: string;
  codeYear: number | null;
  seedMaxYear: number;
  matches: boolean;
}

function extractYearFromComment(content: string): number | null {
  // Match patterns like "2026 tax year", "2026 thresholds", "2026 projected"
  const match = content.match(
    /\b(20\d{2})\s+(?:tax year|thresholds|projected|LTCG|IRMAA|FPL)/i,
  );
  return match ? parseInt(match[1]!, 10) : null;
}

function checkCodeFallbacks(seedChecks: SeedCheck[]): FallbackCheck[] {
  const results: FallbackCheck[] = [];

  const seedMaxByTable = new Map<string, number>();
  for (const s of seedChecks) {
    seedMaxByTable.set(s.table, s.maxYear);
  }

  // tax-tables.ts fallback LTCG brackets
  const taxTables = readFile("src/lib/config/tax-tables.ts");
  const ltcgYear = extractYearFromComment(taxTables);
  results.push({
    file: "src/lib/config/tax-tables.ts",
    label: "LTCG fallback brackets",
    codeYear: ltcgYear,
    seedMaxYear: seedMaxByTable.get("ltcg_brackets") ?? 0,
    matches: ltcgYear === (seedMaxByTable.get("ltcg_brackets") ?? 0),
  });

  // irmaa-tables.ts fallback IRMAA brackets
  const irmaaTables = readFile("src/lib/config/irmaa-tables.ts");
  const irmaaYear = extractYearFromComment(irmaaTables);
  results.push({
    file: "src/lib/config/irmaa-tables.ts",
    label: "IRMAA fallback brackets",
    codeYear: irmaaYear,
    seedMaxYear: seedMaxByTable.get("irmaa_brackets") ?? 0,
    matches: irmaaYear === (seedMaxByTable.get("irmaa_brackets") ?? 0),
  });

  // aca-tables.ts FPL values
  const acaTables = readFile("src/lib/config/aca-tables.ts");
  const acaYear = extractYearFromComment(acaTables);
  // ACA FPL doesn't have a seed table — just check the code comment is for current year
  const currentYear = new Date().getFullYear();
  const acaExpected =
    new Date().getMonth() + 1 >= 1 ? currentYear : currentYear - 1;
  results.push({
    file: "src/lib/config/aca-tables.ts",
    label: "ACA FPL values",
    codeYear: acaYear,
    seedMaxYear: acaExpected, // No seed table — compare against calendar year
    matches: acaYear !== null && acaYear >= acaExpected,
  });

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function run() {
  const expectedTaxYear = getCurrentTaxYear();
  const currentMonth = new Date().getMonth() + 1;

  console.log(
    `Tax parameter staleness check (expected tax year: ${expectedTaxYear}, current month: ${currentMonth})\n`,
  );

  // --- Check 1: Seed file ---
  const seedChecks = checkSeedFile(expectedTaxYear);
  let seedWarnings = 0;
  let seedErrors = 0;

  console.log("=== Seed Data (seed-reference-data.sql) ===\n");

  for (const check of seedChecks) {
    const isPastDeadline = currentMonth >= check.availableAfterMonth;

    if (check.found) {
      console.log(
        `  ✓ ${check.table}: ${check.expectedYear} data present (max year: ${check.maxYear})`,
      );
    } else if (isPastDeadline) {
      console.log(
        `  ✗ ${check.table}: MISSING ${check.expectedYear} data (max year: ${check.maxYear}, expected after month ${check.availableAfterMonth})`,
      );
      seedErrors++;
    } else {
      console.log(
        `  ○ ${check.table}: ${check.expectedYear} data not yet expected (available after month ${check.availableAfterMonth}, max year: ${check.maxYear})`,
      );
      seedWarnings++;
    }
  }

  // --- Check 2: Code fallbacks ---
  const fallbackChecks = checkCodeFallbacks(seedChecks);
  let fallbackErrors = 0;

  console.log("\n=== Code Fallback Sync ===\n");

  for (const check of fallbackChecks) {
    if (check.matches) {
      console.log(
        `  ✓ ${check.file}: ${check.label} — year ${check.codeYear} matches seed`,
      );
    } else if (check.codeYear === null) {
      console.log(
        `  ? ${check.file}: ${check.label} — could not extract year from source comment`,
      );
      // Don't fail — manual review needed
    } else {
      console.log(
        `  ✗ ${check.file}: ${check.label} — code says ${check.codeYear}, seed max is ${check.seedMaxYear}`,
      );
      fallbackErrors++;
    }
  }

  // --- Summary ---
  const totalErrors = seedErrors + fallbackErrors;
  console.log(`\n--- Summary ---`);
  console.log(`Seed:      ${seedErrors} error(s), ${seedWarnings} not-yet-due`);
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
