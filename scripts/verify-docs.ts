/**
 * Documentation Freshness Verification Script
 *
 * Scans the codebase for actual counts of key entities (engine modules,
 * calculators, routers, pages, tables, tests, etc.) and compares them
 * against the counts claimed in DESIGN.md and TESTING.md.
 *
 * Usage:  npx tsx scripts/verify-docs.ts
 * Exit 0: All counts within 10% tolerance AND every tracked count has a marker
 * Exit 1: One or more counts drifted beyond 10%, OR a tracked count is
 *         missing its marker in DESIGN.md/TESTING.md (orphaned tracker)
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
  const doc = readDoc("docs/DESIGN.md");
  if (!doc) return {};

  const claims: Record<string, number> = {};

  // Extract all AUTO-GEN markers: <!-- AUTO-GEN:key -->N<!-- /AUTO-GEN -->
  const markerRe = /<!-- AUTO-GEN:(\w+) -->(\d+)<!-- \/AUTO-GEN -->/g;
  let match;
  while ((match = markerRe.exec(doc)) !== null) {
    const key = match[1];
    // Only take the first occurrence of each key (avoid duplicates inflating)
    if (!(key in claims)) {
      claims[key] = parseInt(match[2], 10);
    }
  }

  return claims;
}

/**
 * Extract claimed counts from TESTING.md.
 * Key pattern: "Total: **672 tests** across **40 vitest files** + **7 Playwright E2E tests** (3 files)."
 */
function parseTestingClaims(): Record<string, number> {
  const doc = readDoc("docs/TESTING.md");
  if (!doc) return {};

  const claims: Record<string, number> = {};

  // Extract all AUTO-GEN markers
  const markerRe = /<!-- AUTO-GEN:(\w+) -->(\d+)<!-- \/AUTO-GEN -->/g;
  let match;
  while ((match = markerRe.exec(doc)) !== null) {
    if (!(match[1] in claims)) {
      claims[match[1]] = parseInt(match[2], 10);
    }
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

// ── AUTO-GEN Marker Update ──────────────────────────────────────────────────

const AUTO_GEN_RE = /<!-- AUTO-GEN:(\w+) -->(\d+)<!-- \/AUTO-GEN -->/g;

function updateAutoGenMarkers(
  relPath: string,
  counts: Record<string, number>,
): { updated: number; path: string } {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) return { updated: 0, path: relPath };

  const original = fs.readFileSync(fullPath, "utf-8");
  let updated = 0;

  const result = original.replace(AUTO_GEN_RE, (match, key, oldVal) => {
    const newVal = counts[key];
    if (newVal !== undefined && String(newVal) !== oldVal) {
      updated++;
      return `<!-- AUTO-GEN:${key} -->${newVal}<!-- /AUTO-GEN -->`;
    }
    return match;
  });

  if (updated > 0) {
    fs.writeFileSync(fullPath, result, "utf-8");
  }

  return { updated, path: relPath };
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

  // --update mode: replace AUTO-GEN markers with actual counts
  const isUpdate = process.argv.includes("--update");
  if (isUpdate) {
    console.log(
      "Mode: --update (replacing AUTO-GEN markers with actual counts)\n",
    );
    const docs = ["docs/DESIGN.md", "docs/TESTING.md"];
    let totalUpdated = 0;
    for (const doc of docs) {
      const { updated, path: docPath } = updateAutoGenMarkers(doc, actual);
      if (updated > 0) {
        console.log(`  Updated ${updated} marker(s) in ${docPath}`);
        totalUpdated += updated;
      } else {
        console.log(`  No changes needed in ${docPath}`);
      }
    }
    console.log(`\n${totalUpdated} marker(s) updated total.`);
    if (totalUpdated > 0) {
      console.log("Re-verifying after update...\n");
    } else {
      console.log("");
    }
  }

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
    console.log("Orphaned trackers (no marker found in docs):");
    for (const r of missing) {
      console.log(
        `  [error] ${r.name}: ${r.actual} actual — add an <!-- AUTO-GEN:KEY -->${r.actual}<!-- /AUTO-GEN --> marker to DESIGN.md/TESTING.md, or remove the tracker from verify-docs.ts`,
      );
    }
  }

  console.log("");

  // Exit non-zero if any count drifted more than 10%, OR if a tracked count
  // has no marker in the docs at all (orphaned tracker — silent drift risk).
  const failures: string[] = [];
  if (errors.length > 0) {
    failures.push(
      `${errors.length} count(s) drifted more than 10% from documentation`,
    );
  }
  if (missing.length > 0) {
    failures.push(
      `${missing.length} orphaned tracker(s) (counted but not claimed anywhere)`,
    );
  }

  if (failures.length > 0) {
    console.log(`FAIL: ${failures.join("; ")}.`);
    process.exit(1);
  } else {
    console.log("PASS: All counts within 10% tolerance, no orphaned trackers.");
  }
}

main();
