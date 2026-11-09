/**
 * The row counts scripts/test-migration.sh lets a migration change: each
 * pending tag's converters declare the tables they may grow or shrink
 * (DataConverter.rowCounts). A tag is pending when the database hasn't
 * recorded its file's hash.
 *
 * Usage: tsx scripts/migration-row-counts.ts <drizzle | drizzle-sqlite>
 * with the recorded hashes on stdin, one per line. Prints one `table|grows`
 * or `table|shrinks` line per allowance.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_CONVERTERS,
  tagConverters,
} from "../src/lib/db/migrate/migration-converters";

/** `table|grows` and `table|shrinks` for every tag of `folder`'s journal
 *  whose file hash `recorded` lacks, sorted. */
export function rowCountAllowances(
  folder: string,
  recorded: ReadonlySet<string>,
  converters = MIGRATION_CONVERTERS,
): string[] {
  const journal = JSON.parse(
    readFileSync(`${folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string }[] };
  const allowed = new Set<string>();
  for (const { tag } of journal.entries) {
    const sql = readFileSync(`${folder}/${tag}.sql`, "utf8");
    if (recorded.has(createHash("sha256").update(sql).digest("hex"))) continue;
    for (const c of tagConverters(tag, converters))
      for (const way of ["grows", "shrinks"] as const)
        for (const table of c.rowCounts?.[way] ?? [])
          allowed.add(`${table}|${way}`);
  }
  return [...allowed].sort();
}

function main() {
  const folder = process.argv[2];
  if (folder !== "drizzle" && folder !== "drizzle-sqlite") {
    console.error("Usage: migration-row-counts.ts <drizzle | drizzle-sqlite>");
    process.exit(1);
  }
  const recorded = new Set(
    readFileSync(0, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const line of rowCountAllowances(folder, recorded)) console.log(line);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
