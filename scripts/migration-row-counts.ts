/**
 * What scripts/test-migration.sh expects of a migration, from the tags the
 * copy hasn't recorded (a tag is pending when its file's hash isn't):
 * the row counts each pending tag's converters may change
 * (DataConverter.rowCounts), and the conversion log lines it must see.
 *
 * Usage: tsx scripts/migration-row-counts.ts <drizzle | drizzle-sqlite>
 *   [--pending | --conversions], with the recorded hashes on stdin. Prints
 * `table|grows` / `table|shrinks` lines, or with --pending one pending tag
 * per line, or with --conversions `tag|n`: the migration_conversion lines
 * a pending tag with converters logs (one per phase it has converters at).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_CONVERTERS,
  tagConverters,
} from "../src/lib/db/migrate/migration-converters";

/** `folder`'s journal tags whose file hash `recorded` lacks, in order. */
export function pendingTags(
  folder: string,
  recorded: ReadonlySet<string>,
): string[] {
  const journal = JSON.parse(
    readFileSync(`${folder}/meta/_journal.json`, "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries
    .map((e) => e.tag)
    .filter((tag) => {
      const sql = readFileSync(`${folder}/${tag}.sql`, "utf8");
      return !recorded.has(createHash("sha256").update(sql).digest("hex"));
    });
}

/** `table|grows` and `table|shrinks` for every pending tag, sorted. */
export function rowCountAllowances(
  folder: string,
  recorded: ReadonlySet<string>,
  converters = MIGRATION_CONVERTERS,
): string[] {
  const allowed = new Set<string>();
  for (const tag of pendingTags(folder, recorded))
    for (const c of tagConverters(tag, converters))
      for (const way of ["grows", "shrinks"] as const)
        for (const table of c.rowCounts?.[way] ?? [])
          allowed.add(`${table}|${way}`);
  return [...allowed].sort();
}

/** `tag|n` for every pending tag with converters: n is how many phases
 *  (beforeSql, afterSql) it has converters at, one log line each. */
export function expectedConversions(
  folder: string,
  recorded: ReadonlySet<string>,
  converters = MIGRATION_CONVERTERS,
): string[] {
  return pendingTags(folder, recorded).flatMap((tag) => {
    const phases = new Set(tagConverters(tag, converters).map((c) => c.runs));
    return phases.size > 0 ? [`${tag}|${phases.size}`] : [];
  });
}

function main() {
  const [folder, mode] = process.argv.slice(2);
  if (
    (folder !== "drizzle" && folder !== "drizzle-sqlite") ||
    (mode !== undefined && mode !== "--pending" && mode !== "--conversions")
  ) {
    console.error(
      "Usage: migration-row-counts.ts <drizzle | drizzle-sqlite> [--pending | --conversions]",
    );
    process.exit(1);
  }
  const recorded = new Set(
    readFileSync(0, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const lines =
    mode === "--pending"
      ? pendingTags(folder, recorded)
      : mode === "--conversions"
        ? expectedConversions(folder, recorded)
        : rowCountAllowances(folder, recorded);
  for (const line of lines) console.log(line);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
