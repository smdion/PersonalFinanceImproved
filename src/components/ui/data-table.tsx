"use client";

import { useState, useMemo, type ReactNode } from "react";
import { Button } from "./button";
import { confirm } from "./confirm-dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SortDirection = "asc" | "desc";

export type DataTableColumn<T> = {
  key: string;
  label: string;
  /** Custom cell renderer. Falls back to `String(row[key])`. */
  render?: (row: T) => ReactNode;
  /** Enable sorting on this column. Provide a comparator or `true` for default string compare. */
  sortable?: boolean | ((a: T, b: T) => number);
  /** Stick this column to the left edge during horizontal scroll. */
  sticky?: boolean;
  /** Extra classes on both <th> and <td>. */
  className?: string;
};

type Props<T extends { id: number | string }> = {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  isLoading?: boolean;
  /** Row key extractor. Defaults to `row.id`. */
  rowKey?: (row: T) => string | number;

  /* -- Header / empty state ---------------------------------------- */
  title?: string;
  emptyMessage?: string;

  /* -- CRUD -------------------------------------------------------- */
  /** Render an inline form for creating/editing rows. */
  renderForm?: (editing: T | null, onClose: () => void) => ReactNode;
  onDelete?: (id: T["id"]) => void;
  isDeleting?: boolean;

  /* -- Styling ----------------------------------------------------- */
  className?: string;
  /** Compact mode reduces cell padding. */
  compact?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DataTable<T extends { id: number | string }>({
  columns,
  data,
  isLoading = false,
  rowKey,
  title,
  emptyMessage,
  renderForm,
  onDelete,
  isDeleting,
  className = "",
  compact = false,
}: Props<T>) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const hasActions = !!(onDelete || renderForm);
  const cellPad = compact ? "px-2 py-1" : "px-3 py-2";

  /* -- Sorting ----------------------------------------------------- */
  const sortedData = useMemo(() => {
    if (!data || !sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortable) return data;

    const comparator =
      typeof col.sortable === "function"
        ? col.sortable
        : (a: T, b: T) => {
            const av = String((a as Record<string, unknown>)[col.key] ?? "");
            const bv = String((b as Record<string, unknown>)[col.key] ?? "");
            return av.localeCompare(bv, undefined, { numeric: true });
          };

    const sorted = [...data].sort(comparator);
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [data, sortKey, sortDir, columns]);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  /* -- Loading ----------------------------------------------------- */
  if (isLoading) {
    return (
      <div className={className}>
        {title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-8 bg-surface-sunken rounded animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  /* -- Render ------------------------------------------------------ */
  return (
    <div className={className}>
      {/* Header */}
      {(title || renderForm) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {renderForm && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Add
            </Button>
          )}
        </div>
      )}

      {/* Inline form */}
      {showForm && renderForm && (
        <div className="mb-4 p-4 bg-surface-sunken rounded border border-default">
          {renderForm(editing, () => {
            setShowForm(false);
            setEditing(null);
          })}
        </div>
      )}

      {/* Empty state */}
      {(!sortedData || sortedData.length === 0) && (
        <p className="text-muted text-sm">
          {emptyMessage ?? `No ${title?.toLowerCase() ?? "records"} found.`}
        </p>
      )}

      {/* Table */}
      {sortedData && sortedData.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-default bg-surface-sunken">
                {columns.map((col) => {
                  const isSortable = !!col.sortable;
                  const isActive = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      className={`text-left ${cellPad} font-medium text-secondary ${
                        col.sticky
                          ? "sticky left-0 z-10 bg-surface-sunken"
                          : ""
                      } ${isSortable ? "cursor-pointer select-none hover:text-primary" : ""} ${col.className ?? ""}`}
                      onClick={isSortable ? () => handleSort(col.key) : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {isActive && (
                          <span className="text-[10px]">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
                {hasActions && (
                  <th
                    className={`text-right ${cellPad} font-medium text-secondary w-24`}
                  >
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row) => {
                const key = rowKey ? rowKey(row) : row.id;
                return (
                  <tr
                    key={key}
                    className="border-b border-default hover:bg-surface-sunken"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${cellPad} ${
                          col.sticky
                            ? "sticky left-0 z-10 bg-surface-primary"
                            : ""
                        } ${col.className ?? ""}`}
                      >
                        {col.render
                          ? col.render(row)
                          : String(
                              (row as Record<string, unknown>)[col.key] ?? "",
                            )}
                      </td>
                    ))}
                    {hasActions && (
                      <td className={`${cellPad} text-right space-x-2`}>
                        {renderForm && (
                          <button
                            onClick={() => {
                              setEditing(row);
                              setShowForm(true);
                            }}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            Edit
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={async () => {
                              if (await confirm("Delete this record?"))
                                onDelete(row.id);
                            }}
                            disabled={isDeleting}
                            className="text-red-600 hover:text-red-800 text-xs disabled:opacity-50"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
