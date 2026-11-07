"use client";

/** What a restore or import does to the household's data: the tables it
 *  empties, and the values it set to their column's default. */

import type { RouterOutputs } from "@/lib/trpc";
import { Button } from "@/components/ui/button";

/** Warns that a restore would empty tables the backup predates. */
export function DataLossWarning({
  tables,
}: {
  tables: { tableName: string; currentRows: number }[] | undefined;
}) {
  if (!tables || tables.length === 0) return null;
  return (
    <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
      <p className="mb-1 font-medium">
        This backup is older than some of your data.
      </p>
      <p className="mb-1">
        These tables will be emptied, and synced history can&rsquo;t be fetched
        again:
      </p>
      <ul className="list-disc pl-4">
        {tables.map((t) => (
          <li key={t.tableName}>
            {t.tableName.replace(/_/g, " ")} ({t.currentRows.toLocaleString()}{" "}
            {t.currentRows === 1 ? "row" : "rows"})
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A backup value set to its column's default by a restore or import. */
export type ValueNote =
  RouterOutputs["version"]["restore"]["valueNotes"][number];

/** Lists the values the last restore or import set to their defaults. */
export function ValueNotes({
  notes,
  onDismiss,
}: {
  notes: ValueNote[];
  onDismiss: () => void;
}) {
  if (notes.length === 0) return null;
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
      <div className="mb-1 flex items-start justify-between gap-3">
        <p className="font-medium">
          The backup held values this version of Ledgr doesn&rsquo;t have. These
          were set to their defaults:
        </p>
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <ul className="list-disc pl-4">
        {notes.map((n) => (
          <li key={`${n.table}.${n.column}.${JSON.stringify(n.value)}`}>
            {n.table.replace(/_/g, " ")}, {n.column.replace(/_/g, " ")}:{" "}
            <code>{JSON.stringify(n.value)}</code> became{" "}
            <code>{n.defaultedTo}</code> ({n.rows}{" "}
            {n.rows === 1 ? "row" : "rows"})
          </li>
        ))}
      </ul>
    </div>
  );
}
