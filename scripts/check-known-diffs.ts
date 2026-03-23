/**
 * Known-Diffs Maintenance Checker
 *
 * Validates that entries in .scratch/data/known-diffs.json are still relevant:
 *   1. Flags entries older than 6 months without review
 *   2. Flags entries referencing fields/tables that no longer exist in the schema
 *   3. Reports summary statistics
 *
 * Usage: pnpm check:known-diffs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const KNOWN_DIFFS_PATH = path.join(ROOT, ".scratch/data/known-diffs.json");
const SCHEMA_PATH = path.join(ROOT, "src/lib/db/schema-pg.ts");
const STALE_MONTHS = 6;

interface KnownDiff {
  id: string;
  section: string;
  description: string;
  winner: string;
  field: string;
  key?: Record<string, string>;
  appValue: string;
  xlsxValue: string;
  addedDate: string;
  updatedDate?: string;
  reviewedDate?: string;
}

interface KnownDiffsFile {
  description: string;
  diffs: KnownDiff[];
}

function loadKnownDiffs(): KnownDiffsFile {
  const raw = fs.readFileSync(KNOWN_DIFFS_PATH, "utf-8");
  return JSON.parse(raw) as KnownDiffsFile;
}

function loadSchemaFields(): Set<string> {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf-8");
  const fields = new Set<string>();

  // Match camelCase JS property names: `propertyName: type(...)`
  const propPattern =
    /^\s+(\w+):\s*(?:text|integer|real|boolean|timestamp|jsonb|varchar|numeric|serial|bigint|doublePrecision|decimal|date)/gm;
  let match;
  while ((match = propPattern.exec(schema)) !== null) {
    const camel = match[1]!;
    fields.add(camel);
    // Also add snake_case version
    fields.add(camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  }

  // Match SQL column names in quotes: type("column_name", ...)
  const sqlNamePattern =
    /(?:text|integer|real|boolean|timestamp|jsonb|varchar|numeric|serial|bigint|doublePrecision|decimal|date)\(\s*["'](\w+)["']/g;
  while ((match = sqlNamePattern.exec(schema)) !== null) {
    fields.add(match[1]!);
  }

  // Also match table names
  const tablePattern = /pgTable\(\s*["'](\w+)["']/g;
  while ((match = tablePattern.exec(schema)) !== null) {
    fields.add(match[1]!);
  }

  return fields;
}

function isStale(diff: KnownDiff): boolean {
  const referenceDate = diff.reviewedDate || diff.updatedDate || diff.addedDate;
  if (!referenceDate) return true;

  const date = new Date(referenceDate);
  const now = new Date();
  const monthsAgo =
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30);
  return monthsAgo > STALE_MONTHS;
}

function main() {
  console.log("Known-Diffs Maintenance Check");
  console.log("=============================\n");

  if (!fs.existsSync(KNOWN_DIFFS_PATH)) {
    console.log("No known-diffs.json found. Nothing to check.");
    process.exit(0);
  }

  const data = loadKnownDiffs();
  const schemaFields = loadSchemaFields();

  const staleEntries: KnownDiff[] = [];
  const orphanedEntries: KnownDiff[] = [];

  for (const diff of data.diffs) {
    // Check staleness
    if (isStale(diff)) {
      staleEntries.push(diff);
    }

    // Check if the field still exists in schema (using snake_case version)
    const snakeField = diff.field.replace(
      /[A-Z]/g,
      (c) => `_${c.toLowerCase()}`,
    );
    const fieldExists =
      schemaFields.has(diff.field) ||
      schemaFields.has(snakeField) ||
      // Compound field names like "profile_name" → check the suffix ("name")
      (diff.field.includes("_") &&
        (schemaFields.has(diff.field.split("_")[0]!) ||
          schemaFields.has(diff.field.split("_").slice(-1)[0]!)));

    if (!fieldExists && !isJsonbSubfield(diff.field)) {
      orphanedEntries.push(diff);
    }
  }

  // Report
  const total = data.diffs.length;
  const bySections = new Map<string, number>();
  for (const d of data.diffs) {
    bySections.set(d.section, (bySections.get(d.section) || 0) + 1);
  }

  console.log(`Total entries: ${total}`);
  console.log(
    `Sections: ${[...bySections.entries()].map(([k, v]) => `${k}(${v})`).join(", ")}\n`,
  );

  if (staleEntries.length > 0) {
    console.log(`\nSTALE ENTRIES (>${STALE_MONTHS} months without review):`);
    console.log("─".repeat(70));
    for (const d of staleEntries) {
      const refDate = d.reviewedDate || d.updatedDate || d.addedDate;
      console.log(`  ${d.id}`);
      console.log(
        `    Last reviewed: ${refDate} | Section: ${d.section} | Field: ${d.field}`,
      );
    }
  }

  if (orphanedEntries.length > 0) {
    console.log(`\nORPHANED ENTRIES (field not found in schema):`);
    console.log("─".repeat(70));
    for (const d of orphanedEntries) {
      console.log(`  ${d.id}`);
      console.log(`    Field: ${d.field} | Section: ${d.section}`);
    }
  }

  // Summary
  console.log("\n" + "─".repeat(35));
  const issues = staleEntries.length + orphanedEntries.length;
  if (issues === 0) {
    console.log(`All ${total} entries are current and valid.`);
  } else {
    console.log(
      `${staleEntries.length} stale, ${orphanedEntries.length} orphaned out of ${total} entries.`,
    );
    if (staleEntries.length > 0) {
      console.log(
        `\nTo resolve stale entries: review each diff, then add "reviewedDate": "${new Date().toISOString().split("T")[0]}" to the entry.`,
      );
    }
    if (orphanedEntries.length > 0) {
      console.log(
        `\nTo resolve orphaned entries: remove them from known-diffs.json if the field was deleted, or update the field name if it was renamed.`,
      );
    }
  }

  process.exit(issues > 0 ? 1 : 0);
}

/** JSONB sub-fields are stored as nested keys — they won't appear as top-level schema columns */
function isJsonbSubfield(field: string): boolean {
  const jsonbFields = [
    "allocation_overrides",
    "api_connections",
    "app_settings",
    "extra_payments",
    "goal_sync_config",
    "home_improvement_items",
    "other_asset_items",
    "performance_accounts",
    "priority_and_contributions",
    "property_taxes",
    "property_values",
    "scenario_assumptions",
    "employer_match",
  ];
  return jsonbFields.includes(field);
}

main();
