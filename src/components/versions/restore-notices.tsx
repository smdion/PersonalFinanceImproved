"use client";

/** What a restore or import does to the household's data: the tables it
 *  empties, the values it set to their column's default and the links it
 *  cleared. */

import { useState } from "react";
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

/** What a restore or import changed in the backup's rows: values set to
 *  their column's default, and links to rows the backup lacks cleared. */
export type RestoreNotes = Pick<
  RouterOutputs["version"]["restore"],
  "valueNotes" | "linkNotes"
>;
const NO_RESTORE_NOTES: RestoreNotes = { valueNotes: [], linkNotes: [] };

/** The notes the Versions page shows: `take` keeps a restore's or an
 *  import's, `dismiss` clears them. */
export function useRestoreNotes() {
  const [shown, setShown] = useState<RestoreNotes>(NO_RESTORE_NOTES);
  return {
    shown,
    take: ({ valueNotes, linkNotes }: RestoreNotes) =>
      setShown({ valueNotes, linkNotes }),
    dismiss: () => setShown(NO_RESTORE_NOTES),
  };
}

const rowCount = (rows: number) => `${rows} ${rows === 1 ? "row" : "rows"}`;

/** Lists what the last restore or import changed in the backup's rows. */
export function ValueNotes({
  notes: { valueNotes, linkNotes },
  onDismiss,
}: {
  notes: RestoreNotes;
  onDismiss: () => void;
}) {
  if (valueNotes.length === 0 && linkNotes.length === 0) return null;
  return (
    <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
      <div className="flex justify-end">
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {valueNotes.length > 0 && (
        <>
          <p className="mb-1 font-medium">
            The backup held values this version of Ledgr doesn&rsquo;t have.
            These were set to their defaults:
          </p>
          <ul className="list-disc pl-4">
            {valueNotes.map((n) => (
              <li key={`${n.table}.${n.column}.${JSON.stringify(n.value)}`}>
                {n.table.replace(/_/g, " ")}, {n.column.replace(/_/g, " ")}:{" "}
                <code>{JSON.stringify(n.value)}</code> became{" "}
                <code>{n.defaultedTo}</code> ({rowCount(n.rows)})
              </li>
            ))}
          </ul>
        </>
      )}
      {linkNotes.length > 0 && (
        <>
          <p className="mt-2 mb-1 font-medium">
            The backup linked to rows it doesn&rsquo;t hold. These links were
            cleared, as deleting those rows would have:
          </p>
          <ul className="list-disc pl-4">
            {linkNotes.map((n) => (
              <li key={`${n.table}.${n.column}`}>
                {n.table.replace(/_/g, " ")}, {n.column.replace(/_/g, " ")} (
                {rowCount(n.rows)})
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
