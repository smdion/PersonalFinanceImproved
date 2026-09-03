"use client";

/**
 * Generic year + filing-status bracket editor shared by the IRMAA and LTCG
 * settings tabs (the two were ~85% identical copies that had already
 * drifted). Owns the year picker / copy-from-year / empty state / delete
 * confirmation / 3-column card+table shell; each consumer supplies its
 * column definitions, default brackets, and thin CRUD callbacks (so this
 * stays tRPC-agnostic and simply typed).
 *
 * `tax_brackets` is a third, less-similar variant (withholding JSON shape,
 * 2×3 rows/year) — deliberately NOT folded in here.
 */
import { useState } from "react";
import { InlineEdit } from "@/components/ui/inline-edit";
import { Skeleton } from "@/components/ui/skeleton";

export type BracketFilingStatus = "MFJ" | "Single" | "HOH";

const FILING_STATUSES: readonly BracketFilingStatus[] = [
  "MFJ",
  "Single",
  "HOH",
] as const;
const STATUS_LABELS: Record<BracketFilingStatus, string> = {
  MFJ: "Married Filing Jointly",
  Single: "Single",
  HOH: "Head of Household",
};

export type BracketRow<TEntry> = {
  id: number;
  taxYear: number;
  filingStatus: string;
  brackets: TEntry[];
};

export type BracketColumn<TEntry> = {
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
  isLoading: boolean;
  rows: BracketRow<TEntry>[];
  columns: BracketColumn<TEntry>[];
  defaultBrackets: TEntry[];
  entryKey: (entry: TEntry, index: number) => React.Key;
  onUpdateRow: (rowId: number, brackets: TEntry[]) => void;
  onCreateRow: (
    taxYear: number,
    filingStatus: BracketFilingStatus,
    brackets: TEntry[],
  ) => Promise<unknown>;
  onDeleteRow: (rowId: number) => Promise<unknown>;
  intro?: React.ReactNode;
  sourceNote: React.ReactNode;
};

export function BracketTableEditor<TEntry>({
  title,
  noun,
  year,
  admin,
  isLoading,
  rows,
  columns,
  defaultBrackets,
  entryKey,
  onUpdateRow,
  onCreateRow,
  onDeleteRow,
  intro,
  sourceNote,
}: Props<TEntry>) {
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  // Distinguishes "the dropdown hasn't been touched yet" (fall back to the
  // most recent year, `copyFrom` is still its `null` initial value) from
  // "the admin explicitly picked Empty brackets" (also `null`, but must NOT
  // fall back — the two states used to collapse into the same value, which
  // made "Empty brackets" unreachable whenever any prior year existed).
  const [copyFromTouched, setCopyFromTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-6 w-48" />;

  const years = Array.from(new Set(rows.map((r) => r.taxYear))).sort(
    (a, b) => b - a,
  );
  const yearData = rows.filter((r) => r.taxYear === year);
  const effectiveCopyFrom = copyFromTouched
    ? copyFrom
    : (copyFrom ?? years[0] ?? null);

  const handleAddYear = async () => {
    if (years.includes(year)) return;
    if (effectiveCopyFrom) {
      for (const row of rows.filter((r) => r.taxYear === effectiveCopyFrom)) {
        await onCreateRow(
          year,
          row.filingStatus as BracketFilingStatus,
          row.brackets,
        );
      }
    } else {
      for (const fs of FILING_STATUSES) {
        await onCreateRow(year, fs, defaultBrackets);
      }
    }
    setCopyFrom(null);
    setCopyFromTouched(false);
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
        <h2 className="text-lg font-semibold mb-4">{title}</h2>
        <div className="p-4 border border-dashed rounded-lg text-center">
          <p className="text-muted text-sm mb-3">
            No {noun} brackets configured for {year}.
          </p>
          {admin && (
            <div className="flex items-center justify-center gap-3">
              {years.length > 0 && (
                <label className="text-sm text-secondary">
                  Copy from:
                  <select
                    value={effectiveCopyFrom ?? ""}
                    onChange={(e) => {
                      setCopyFrom(
                        e.target.value ? parseInt(e.target.value) : null,
                      );
                      setCopyFromTouched(true);
                    }}
                    className="ml-2 px-2 py-1 text-sm border rounded"
                  >
                    <option value="">Empty brackets</option>
                    {years.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                onClick={handleAddYear}
                className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Add {year}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {intro && <div className="text-xs text-muted mb-4">{intro}</div>}

      {confirmDelete === year && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-800">
            Delete all {year} {noun} brackets? This cannot be undone.
          </span>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteYear}
              className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1 text-sm text-muted hover:text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {FILING_STATUSES.map((status) => {
          const row = yearData.find((r) => r.filingStatus === status);
          if (!row) return null;
          return (
            <div key={status} className="border rounded-lg overflow-hidden">
              <div className="bg-surface-sunken px-4 py-2 border-b">
                <h3 className="font-medium text-primary">
                  {STATUS_LABELS[status]}
                </h3>
              </div>
              <div className="p-3">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-muted">
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
                        className="border-t border-subtle"
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

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-faint">{sourceNote}</p>
        {admin && years.length > 1 && confirmDelete !== year && (
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
