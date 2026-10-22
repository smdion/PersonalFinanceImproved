/**
 * Reference data (contribution limits, tax brackets, LTCG / IRMAA brackets,
 * poverty lines, tax parameters) comes from `seed-reference-data.sql`. The
 * migrator applies it on every start (db-migrate.ts — additive: `ON
 * CONFLICT DO NOTHING`, so a new tax year reaches existing installs).
 *
 * Paths that rewrite those tables in a running app — a version restore, a
 * backup import, "Reset all data" — re-apply it here, so the tables never
 * sit older (or empty) until the next restart. Demo schemas copy the same
 * tables from public (see `referenceTableNames`).
 */
import * as fs from "fs";
import * as path from "path";
import { sql } from "drizzle-orm";
import { execRaw } from "./compat";

function readSeed(): string {
  return fs.readFileSync(path.resolve("./seed-reference-data.sql"), "utf-8");
}

/** The seed's statements, comments dropped. Split at line-ending
 *  semicolons — values hold mid-line ones. */
export function seedStatements(seedSql: string): string[] {
  return seedSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The tables the seed writes. */
export function referenceTableNames(seedSql: string = readSeed()): string[] {
  const names = new Set<string>();
  const re = /INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seedSql)) !== null) names.add(m[1]!);
  return [...names];
}

/** Re-apply the reference seed (additive) — run after anything that
 *  replaced or emptied the reference tables. */
export async function reconcileReferenceData(
  db: Parameters<typeof execRaw>[0],
): Promise<void> {
  for (const statement of seedStatements(readSeed()))
    await execRaw(db, sql.raw(statement));
}
