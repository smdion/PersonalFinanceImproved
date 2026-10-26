/**
 * The PostgreSQL schema's source text for tools that read it as text (docs
 * generation, the known-diffs check, table counts): src/lib/db/pg/*.ts in
 * the order schema-pg.ts re-exports them, joined.
 */
import * as fs from "fs";
import * as path from "path";

export function pgSchemaFiles(root: string): string[] {
  const barrel = fs.readFileSync(
    path.join(root, "src/lib/db/schema-pg.ts"),
    "utf-8",
  );
  return [...barrel.matchAll(/export \* from "\.\/pg\/([\w-]+)";/g)].map((m) =>
    path.join(root, "src/lib/db/pg", `${m[1]}.ts`),
  );
}

export function readPgSchemaSource(root: string): string {
  return pgSchemaFiles(root)
    .map((f) => fs.readFileSync(f, "utf-8"))
    .join("\n");
}
