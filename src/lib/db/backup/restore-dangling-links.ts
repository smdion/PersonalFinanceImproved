/** A backup's links that its foreign key sets to null when the parent row is
 *  deleted (ON DELETE SET NULL), set to null when the backup lacks the parent,
 *  as the key would have, so one dangling link doesn't refuse the restore. */
import { isRow } from "../migrate/converter-rows";
import { log } from "@/lib/logger";
import { SCHEMA_REFERENCES } from "./restore-conversions";

/** A link the step set to null, and how many rows held it; the log names
 *  the rows by id, never a value. */
export type LinkNote = { table: string; column: string; rows: number };

/** `tables` with each SET NULL link whose parent table the backup holds but
 *  whose parent row (by id) it lacks set to null, and a note and warning per
 *  link. A parent table the backup doesn't hold is left to the insert. */
export function nullDanglingLinks(
  tables: Record<string, unknown[]>,
  from: "restore" | "import",
): { tables: Record<string, unknown[]>; linkNotes: LinkNote[] } {
  const out: Record<string, unknown[]> = { ...tables };
  const nulled: { table: string; column: string; rowIds: unknown[] }[] = [];
  for (const link of SCHEMA_REFERENCES) {
    if (link.onDelete !== "set null") continue;
    const parents = tables[link.parent];
    const rows = out[link.child];
    if (!Array.isArray(parents) || !Array.isArray(rows)) continue;
    const present = new Set(parents.filter(isRow).map((p) => String(p["id"])));
    const rowIds: unknown[] = [];
    const next = rows.map((row) => {
      if (!isRow(row)) return row;
      const value = row[link.column];
      if (value === null || value === undefined) return row;
      if (present.has(String(value))) return row;
      rowIds.push(row["id"]);
      return { ...row, [link.column]: null };
    });
    if (rowIds.length === 0) continue;
    out[link.child] = next;
    nulled.push({ table: link.child, column: link.column, rowIds });
  }
  for (const { table, column, rowIds } of nulled)
    log("warn", "backup_dangling_link_nulled", {
      from,
      table,
      column,
      rowIds,
      rows: rowIds.length,
    });
  const linkNotes = nulled.map(({ table, column, rowIds }) => ({
    table,
    column,
    rows: rowIds.length,
  }));
  return { tables: out, linkNotes };
}
