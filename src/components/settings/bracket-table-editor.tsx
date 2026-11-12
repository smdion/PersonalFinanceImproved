"use client";

/**
 * Year + filing-status bracket editor shared by the IRMAA and LTCG settings tabs. Owns the year
 * picker, copy-from-year, empty state, delete confirmation and card/table shell; consumers supply
 * columns, default brackets and CRUD callbacks (so this stays tRPC-agnostic).
 */
import { useState } from "react";
import { AddYearPanel, DeleteYearConfirm } from "./tax-year-actions";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SettingsQueryBoundary, queryPending } from "./settings-query-boundary";
import type { BoundaryQuery } from "@/components/ui/query-boundary";
import {
  TAX_TABLE_ROWS,
  filingTable,
  type FilingStatusKey,
} from "@/lib/config/filing-status";
import { FILING_STATUS_LABELS } from "@/lib/config/display-labels";

export type BracketRow<TEntry> = {
  id: number;
  taxYear: number;
  filingStatus: string;
  brackets: TEntry[];
  /** Ledgr ships this table (Reset to shipped, never deleted). */
  shipped?: boolean;
  /** Where it came from — "user" once the household changed it. */
  origin?: string;
};

type BracketColumn<TEntry> = {
  header: string;
  align?: "left" | "right";
  /** Render one cell. `onSave` merges a partial entry into this bracket row
   *  and pushes the update; `isEditable` is the admin flag. */
  cell: (
    entry: TEntry,
    ctx: { onSave: (patch: Partial<TEntry>) => void; isEditable: boolean },
  ) => React.ReactNode;
};

/** A plain numeric `<InlineEdit>` cell — the common case. `transform` lets a
 *  column store something other than the parsed number (LTCG rate ÷ 100). */
export function numericCell<TEntry>(opts: {
  value: (e: TEntry) => number;
  display: (e: TEntry) => string;
  field: keyof TEntry;
  strip?: (raw: string) => string;
  transform?: (n: number) => number;
}): BracketColumn<TEntry>["cell"] {
  const strip = opts.strip ?? ((r) => r.replace(/[$,\s]/g, ""));
  // Not a component — a `cell` render callback invoked as `col.cell(entry, ctx)`,
  // never mounted as `<col.cell />`. react/display-name misfires on the JSX return.
  // eslint-disable-next-line react/display-name
  return (entry, { onSave, isEditable }) => (
    <InlineEdit
      value={opts.value(entry).toString()}
      formatDisplay={() => opts.display(entry)}
      parseInput={strip}
      onSave={(v) => {
        const n = parseFloat(v);
        if (isNaN(n)) return;
        onSave({
          [opts.field]: opts.transform ? opts.transform(n) : n,
        } as Partial<TEntry>);
      }}
      type="number"
      className="text-sm"
      isEditable={isEditable}
    />
  );
}

type Props<TEntry> = {
  title: string;
  /** Short name used in confirmation copy: "Delete all {year} {noun} brackets?" */
  noun: string;
  year: number;
  admin: boolean;
  query: BoundaryQuery;
  rows: BracketRow<TEntry>[];
  columns: BracketColumn<TEntry>[];
  defaultBrackets: TEntry[];
  entryKey: (entry: TEntry, index: number) => React.Key;
  onUpdateRow: (rowId: number, brackets: TEntry[]) => void;
  onCreateRow: (
    taxYear: number,
    filingStatus: FilingStatusKey,
    brackets: TEntry[],
  ) => Promise<unknown>;
  onDeleteRow: (rowId: number) => Promise<unknown>;
  /** Put a shipped table the household changed back to the shipped one. */
  onResetRow: (rowId: number) => Promise<unknown>;
  intro?: React.ReactNode;
  sourceNote: React.ReactNode;
};

export function BracketTableEditor<TEntry>({
  title,
  noun,
  year,
  admin,
  query,
  rows,
  columns,
  defaultBrackets,
  entryKey,
  onUpdateRow,
  onCreateRow,
  onDeleteRow,
  onResetRow,
  intro,
  sourceNote,
}: Props<TEntry>) {
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (queryPending(query)) return <SettingsQueryBoundary query={query} />;

  const years = Array.from(new Set(rows.map((r) => r.taxYear))).sort(
    (a, b) => b - a,
  );
  const yearData = rows.filter((r) => r.taxYear === year);
  // A year Ledgr ships can't be deleted (it would come back on restart).
  const yearShipped = yearData.some((r) => r.shipped);
  // A new year starts from a real one when there is one: an empty
  // placeholder would quietly price every figure at 0 until edited.
  const effectiveCopyFrom = copyFrom ?? years[0] ?? null;

  const handleAddYear = async () => {
    if (years.includes(year)) return;
    if (effectiveCopyFrom) {
      for (const row of rows.filter((r) => r.taxYear === effectiveCopyFrom)) {
        await onCreateRow(
          year,
          row.filingStatus as FilingStatusKey,
          row.brackets,
        );
      }
    } else {
      for (const fs of TAX_TABLE_ROWS) {
        await onCreateRow(year, fs, defaultBrackets);
      }
    }
    setCopyFrom(null);
  };

  const handleDeleteYear = async () => {
    for (const row of rows.filter((r) => r.taxYear === year)) {
      await onDeleteRow(row.id);
    }
    setConfirmDelete(null);
  };

  if (yearData.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <AddYearPanel
          message={
            <>
              No {noun} brackets configured for {year}.
            </>
          }
          admin={admin}
          year={year}
          years={years}
          copyFrom={effectiveCopyFrom}
          onCopyFromChange={setCopyFrom}
          onAdd={handleAddYear}
        />
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {intro && <div className="text-muted mb-4 text-xs">{intro}</div>}

      {confirmDelete === year && (
        <DeleteYearConfirm
          message={
            <>
              Delete all {year} {noun} brackets? This cannot be undone.
            </>
          }
          onDelete={handleDeleteYear}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {TAX_TABLE_ROWS.map((status) => {
          const row = yearData.find((r) => r.filingStatus === status);
          if (!row) return null;
          return (
            <div key={status} className="overflow-hidden rounded-lg border">
              <div className="bg-surface-sunken border-b px-4 py-2">
                <h3 className="text-primary font-medium">
                  {filingTable(FILING_STATUS_LABELS, status)}
                  {admin && row.shipped && row.origin === "user" && (
                    <button
                      type="button"
                      onClick={() => onResetRow(row.id)}
                      className="text-caption ml-2 font-normal text-blue-600 hover:underline"
                      title="You changed this table — put back the one Ledgr ships"
                    >
                      Reset to shipped
                    </button>
                  )}
                </h3>
              </div>
              <div className="p-3">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-muted text-xs">
                      {columns.map((col) => (
                        <th
                          key={col.header}
                          className={`pb-1 font-normal ${
                            col.align === "right" ? "text-right" : "text-left"
                          }`}
                        >
                          {col.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {row.brackets.map((entry, i) => (
                      <tr
                        key={entryKey(entry, i)}
                        className="border-subtle border-t"
                      >
                        {columns.map((col) => (
                          <td
                            key={col.header}
                            className={`py-1 ${
                              col.align === "right" ? "px-2 text-right" : "pr-2"
                            }`}
                          >
                            {col.cell(entry, {
                              isEditable: admin,
                              onSave: (patch) => {
                                const next = row.brackets.map((b, j) =>
                                  j === i ? { ...b, ...patch } : b,
                                );
                                onUpdateRow(row.id, next);
                              },
                            })}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-faint text-xs">{sourceNote}</p>
        {admin &&
          years.length > 1 &&
          !yearShipped &&
          confirmDelete !== year && (
            <button
              onClick={() => setConfirmDelete(year)}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Delete {year}
            </button>
          )}
      </div>
    </div>
  );
}
