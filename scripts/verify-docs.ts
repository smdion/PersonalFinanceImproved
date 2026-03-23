/**
 * Documentation Freshness Verification Script
 *
 * Scans the codebase for actual counts of key entities (engine modules,
 * calculators, routers, pages, tables, tests, etc.) and compares them
 * against the counts claimed in DESIGN.md and TESTING.md.
 *
 * Usage:  npx tsx scripts/verify-docs.ts
 * Exit 0: All counts within 10% tolerance
 * Exit 1: One or more counts drifted beyond 10%
 */

import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect files matching a regex pattern under a directory */
function globFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...globFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/** List immediate files in a directory matching a pattern (non-recursive) */
function listFiles(dir: string, pattern: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && pattern.test(e.name))
    .map((e) => path.join(dir, e.name));
}

/** Count occurrences of a regex in a file's content */
function countInFile(filePath: string, pattern: RegExp): number {
  if (!fs.existsSync(filePath)) return 0;
  const content = fs.readFileSync(filePath, "utf-8");
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

// ── Count Functions ──────────────────────────────────────────────────────────

function countEngineModules(): number {
  const dir = path.join(ROOT, "src/lib/calculators/engine");
  const files = listFiles(dir, /\.ts$/);
  // Exclude index.ts — it's a barrel re-export, not a module
  return files.filter((f) => path.basename(f) !== "index.ts").length;
}

function countCalculators(): number {
  const dir = path.join(ROOT, "src/lib/calculators");
  const files = listFiles(dir, /\.ts$/);
  // Exclude types.ts (shared types) — only domain calculator files
  return files.filter((f) => path.basename(f) !== "types.ts").length;
}

function countRouters(): number {
  const dir = path.join(ROOT, "src/server/routers");
  const files = listFiles(dir, /\.ts$/);
  // Exclude index.ts (barrel) and _shared.ts (helpers)
  return files.filter(
    (f) => path.basename(f) !== "index.ts" && path.basename(f) !== "_shared.ts",
  ).length;
}

function countSettingsSubRouters(): number {
  const dir = path.join(ROOT, "src/server/routers/settings");
  const files = listFiles(dir, /\.ts$/);
  return files.filter(
    (f) => path.basename(f) !== "index.ts" && path.basename(f) !== "_shared.ts",
  ).length;
}

function countPages(): number {
  return globFiles(path.join(ROOT, "src/app"), /^page\.tsx$/).length;
}

function countTables(): number {
  return countInFile(path.join(ROOT, "src/lib/db/schema-pg.ts"), /pgTable\(/g);
}

function countTestFiles(): number {
  return globFiles(path.join(ROOT, "tests"), /\.test\.(ts|tsx)$/).length;
}

function countE2EFiles(): number {
  return globFiles(path.join(ROOT, "tests/e2e"), /\.spec\.ts$/).length;
}

function countMigrations(): number {
  return listFiles(path.join(ROOT, "drizzle"), /\.sql$/).length;
}

function countSettingsComponents(): number {
  return listFiles(path.join(ROOT, "src/components/settings"), /\.tsx$/).length;
}

function countUIComponents(): number {
  return listFiles(path.join(ROOT, "src/components/ui"), /\.tsx$/).length;
}

function countDashboardCards(): number {
  // Count all card .tsx files: cards/dashboard/*.tsx + cards/*.tsx (top-level card components)
  // Exclude utility files (index.ts, utils.tsx)
  const dashboardDir = path.join(ROOT, "src/components/cards/dashboard");
  const cardsDir = path.join(ROOT, "src/components/cards");

  const dashboardCards = listFiles(dashboardDir, /\.tsx$/).filter(
    (f) => !["index.ts", "utils.tsx"].includes(path.basename(f)),
  );
  const topLevelCards = listFiles(cardsDir, /\.tsx$/);

  return dashboardCards.length + topLevelCards.length;
}

function _countComponentsBySubdir(): Record<string, number> {
  const componentsDir = path.join(ROOT, "src/components");
  const result: Record<string, number> = {};
  if (!fs.existsSync(componentsDir)) return result;

  const entries = fs.readdirSync(componentsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subdir = path.join(componentsDir, entry.name);
      const files = globFiles(subdir, /\.tsx$/);
      if (files.length > 0) {
        result[entry.name] = files.length;
      }
    }
  }
  return result;
}

// Specific subdirectory component counts (claimed in DESIGN.md tree)
function countPaycheckComponents(): number {
  return listFiles(path.join(ROOT, "src/components/paycheck"), /\.tsx$/).length;
}

function countBudgetComponents(): number {
  return listFiles(path.join(ROOT, "src/components/budget"), /\.tsx$/).length;
}

function countMortgageComponents(): number {
  return listFiles(path.join(ROOT, "src/components/mortgage"), /\.tsx$/).length;
}

function countSavingsComponents(): number {
  return listFiles(path.join(ROOT, "src/components/savings"), /\.tsx$/).length;
}

function countNetworthComponents(): number {
  return listFiles(path.join(ROOT, "src/components/networth"), /\.tsx$/).length;
}

function countPerformanceComponents(): number {
  return listFiles(path.join(ROOT, "src/components/performance"), /\.tsx$/)
    .length;
}

// ── Doc Parsing ──────────────────────────────────────────────────────────────

function readDoc(relPath: string): string {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`  WARNING: ${relPath} not found`);
    return "";
  }
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Extract claimed numeric counts from DESIGN.md.
 * Patterns searched (flexible regex):
 *   - "**N pages:**" or "N pages"
 *   - "N calculators" / "N modules" / "N routers" / etc.
 *   - "# N migrations" / "N settings" / etc.
 *   - Tree comments like "# 21 shared components"
 */
function parseDesignClaims(): Record<string, number> {
  const doc = readDoc(".scratch/docs/DESIGN.md");
  if (!doc) return {};

  const claims: Record<string, number> = {};

  // Helper: find first match and extract the number
  const extract = (key: string, pattern: RegExp): void => {
    const match = doc.match(pattern);
    if (match?.[1]) {
      claims[key] = parseInt(match[1], 10);
    }
  };

  // "**24 pages:**" or "24 pages"
  extract("pages", /\*\*(\d+)\s+pages[:\*]/);

  // "13 calculators" (in bold or plain)
  extract("calculators", /\*?\*?(\d+)\s+calculators\b/);

  // "20 modules" in engine context
  extract("engineModules", /engine[^]*?(\d+)\s+modules/i);

  // "20 primary tRPC routers"
  extract("primaryRouters", /(\d+)\s+primary\s+tRPC\s+routers/);

  // "6 settings sub-routers"
  extract("settingsSubRouters", /(\d+)\s+settings\s+sub-routers/);

  // "8 migrations"
  extract("migrations", /(\d+)\s+migrations/);

  // "50+ tables" — extract the base number
  extract("tables", /(\d+)\+?\s+tables/);

  // "17 settings components" or "17 settings sub-components"
  extract("settingsComponents", /(\d+)\s+settings\s+(?:sub-)?components/);

  // "17 dashboard card components"
  extract("dashboardCards", /(\d+)\s+dashboard\s+card\s+components/);

  // "21 shared components" (in tree comment)
  extract("uiComponents", /(\d+)\s+shared\s+components/);

  // Domain component counts from tree comments
  extract("paycheckComponents", /(\d+)\s+paycheck\s+domain\s+components/);
  extract("budgetComponents", /(\d+)\s+budget\s+domain\s+components/);
  extract("mortgageComponents", /(\d+)\s+mortgage\s+domain\s+components/);
  extract("savingsComponents", /(\d+)\s+savings\s+domain\s+components/);
  extract(
    "networthComponents",
    /(\d+)\s+net\s+worth\s+visualization\s+components/,
  );
  extract(
    "performanceComponents",
    /(\d+)\s+performance\s+tracking\s+components/,
  );

  return claims;
}

/**
 * Extract claimed counts from TESTING.md.
 * Key pattern: "Total: **672 tests** across **40 vitest files** + **7 Playwright E2E tests** (3 files)."
 */
function parseTestingClaims(): Record<string, number> {
  const doc = readDoc(".scratch/docs/TESTING.md");
  if (!doc) return {};

  const claims: Record<string, number> = {};

  // "**40 vitest files**"
  const vitestMatch = doc.match(/\*\*(\d+)\s+vitest\s+files\*\*/);
  if (vitestMatch?.[1]) {
    claims["vitestFiles"] = parseInt(vitestMatch[1], 10);
  }

  // "**7 Playwright E2E tests** (3 files)"
  const e2eFileMatch = doc.match(
    /Playwright\s+E2E\s+tests\*?\*?\s*\((\d+)\s+files?\)/,
  );
  if (e2eFileMatch?.[1]) {
    claims["e2eFiles"] = parseInt(e2eFileMatch[1], 10);
  }

  // Total test count: "**672 tests**"
  const totalMatch = doc.match(/\*\*(\d+)\s+tests\*\*/);
  if (totalMatch?.[1]) {
    claims["totalTests"] = parseInt(totalMatch[1], 10);
  }

  return claims;
}

// ── Comparison & Reporting ───────────────────────────────────────────────────

interface CheckResult {
  name: string;
  actual: number;
  claimed: number | null;
  status: "OK" | "DRIFT" | "MISSING";
  drift?: number; // percentage drift
}

function compare(
  name: string,
  actual: number,
  claimed: number | undefined,
): CheckResult {
  if (claimed === undefined) {
    return { name, actual, claimed: null, status: "MISSING" };
  }

  if (claimed === 0 && actual === 0) {
    return { name, actual, claimed, status: "OK" };
  }

  const driftPct =
    claimed === 0
      ? 100
      : Math.round((Math.abs(actual - claimed) / claimed) * 100);

  return {
    name,
    actual,
    claimed,
    status: actual === claimed ? "OK" : "DRIFT",
    drift: actual === claimed ? undefined : driftPct,
  };
}

function main(): void {
  console.log("");
  console.log("Documentation Freshness Check");
  console.log("=============================");
  console.log("");
  console.log("Checking actual vs documented counts...");
  console.log("");

  // Gather actual counts
  const actual = {
    engineModules: countEngineModules(),
    calculators: countCalculators(),
    primaryRouters: countRouters(),
    settingsSubRouters: countSettingsSubRouters(),
    pages: countPages(),
    tables: countTables(),
    migrations: countMigrations(),
    vitestFiles: countTestFiles(),
    e2eFiles: countE2EFiles(),
    settingsComponents: countSettingsComponents(),
    dashboardCards: countDashboardCards(),
    uiComponents: countUIComponents(),
    paycheckComponents: countPaycheckComponents(),
    budgetComponents: countBudgetComponents(),
    mortgageComponents: countMortgageComponents(),
    savingsComponents: countSavingsComponents(),
    networthComponents: countNetworthComponents(),
    performanceComponents: countPerformanceComponents(),
  };

  // Parse doc claims
  const designClaims = parseDesignClaims();
  const testingClaims = parseTestingClaims();
  const claims = { ...designClaims, ...testingClaims };

  // Define checks with display names
  const checks: { key: string; label: string }[] = [
    { key: "engineModules", label: "Engine modules" },
    { key: "calculators", label: "Calculators" },
    { key: "primaryRouters", label: "Primary routers" },
    { key: "settingsSubRouters", label: "Settings sub-routers" },
    { key: "pages", label: "Pages" },
    { key: "tables", label: "DB tables" },
    { key: "migrations", label: "Migrations" },
    { key: "vitestFiles", label: "Vitest files" },
    { key: "e2eFiles", label: "E2E spec files" },
    { key: "settingsComponents", label: "Settings components" },
    { key: "dashboardCards", label: "Dashboard cards" },
    { key: "uiComponents", label: "UI components" },
    { key: "paycheckComponents", label: "Paycheck components" },
    { key: "budgetComponents", label: "Budget components" },
    { key: "mortgageComponents", label: "Mortgage components" },
    { key: "savingsComponents", label: "Savings components" },
    { key: "networthComponents", label: "Net worth components" },
    { key: "performanceComponents", label: "Performance components" },
  ];

  const results: CheckResult[] = checks.map((c) =>
    compare(c.label, actual[c.key as keyof typeof actual], claims[c.key]),
  );

  // Print table
  const nameWidth = 26;
  const numWidth = 7;

  const header = [
    "Check".padEnd(nameWidth),
    "Actual".padStart(numWidth),
    "Claimed".padStart(numWidth),
    "  Status",
  ].join("  ");

  const separator = "\u2500".repeat(header.length);

  console.log(`  ${header}`);
  console.log(`  ${separator}`);

  for (const r of results) {
    const name = r.name.padEnd(nameWidth);
    const actualStr = String(r.actual).padStart(numWidth);
    const claimedStr =
      r.claimed !== null
        ? String(r.claimed).padStart(numWidth)
        : "   N/A ".padStart(numWidth);

    let statusStr: string;
    if (r.status === "OK") {
      statusStr = "  OK";
    } else if (r.status === "MISSING") {
      statusStr = "  MISSING (not in docs)";
    } else {
      statusStr = `  DRIFT (${r.drift}%)`;
    }

    console.log(`  ${name}  ${actualStr}  ${claimedStr}${statusStr}`);
  }

  // Summary
  const drifted = results.filter((r) => r.status === "DRIFT");
  const missing = results.filter((r) => r.status === "MISSING");
  const errors = drifted.filter((r) => (r.drift ?? 0) > 10);

  console.log("");
  console.log(
    `Summary: ${drifted.length} drifted, ${missing.length} missing, ${errors.length} errors (>10% drift)`,
  );

  // Detail on drifted items
  if (drifted.length > 0) {
    console.log("");
    console.log("Drift details:");
    for (const r of drifted) {
      const direction = r.actual > (r.claimed ?? 0) ? "more" : "fewer";
      const diff = Math.abs(r.actual - (r.claimed ?? 0));
      const severity = (r.drift ?? 0) > 10 ? "ERROR" : "warn";
      console.log(
        `  [${severity}] ${r.name}: ${diff} ${direction} than documented (${r.actual} actual vs ${r.claimed} claimed, ${r.drift}% drift)`,
      );
    }
  }

  if (missing.length > 0) {
    console.log("");
    console.log("Missing from docs:");
    for (const r of missing) {
      console.log(
        `  [info] ${r.name}: ${r.actual} actual (no claim found in docs)`,
      );
    }
  }

  console.log("");

  // Exit non-zero if any count drifted more than 10%
  if (errors.length > 0) {
    console.log(
      `FAIL: ${errors.length} count(s) drifted more than 10% from documentation.`,
    );
    process.exit(1);
  } else {
    console.log("PASS: All counts within 10% tolerance.");
  }
}

main();
