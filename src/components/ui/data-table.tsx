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
  isCompact?: boolean;
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
  isCompact = false,
}: Props<T>) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const hasActions = !!(onDelete || renderForm);
  const cellPad = isCompact ? "px-2 py-1" : "px-3 py-2";

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
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              // eslint-disable-next-line react/no-array-index-key -- skeleton placeholders have no identity
              key={i}
              className="bg-surface-sunken h-8 animate-pulse rounded"
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
        <div className="mb-4 flex items-center justify-between">
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
        <div className="bg-surface-sunken border-default mb-4 rounded border p-4">
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
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-default bg-surface-sunken border-b">
                {columns.map((col) => {
                  const isSortable = !!col.sortable;
                  const isActive = sortKey === col.key;
                  const ariaSort:
                    "ascending" | "descending" | "none" | undefined = isSortable
                    ? isActive
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                    : undefined;
                  const headerContent = (
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {isActive && (
                        <>
                          <span className="text-caption" aria-hidden="true">
                            {sortDir === "asc" ? "▲" : "▼"}
                          </span>
                          <span className="sr-only">
                            {sortDir === "asc"
                              ? ", sorted ascending"
                              : ", sorted descending"}
                          </span>
                        </>
                      )}
                    </span>
                  );
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={ariaSort}
                      className={`text-left ${cellPad} text-secondary font-medium ${
                        col.sticky ? "bg-surface-sunken sticky left-0 z-10" : ""
                      } ${col.className ?? ""}`}
                    >
                      {isSortable ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className="hover:text-primary w-full cursor-pointer text-left select-none"
                        >
                          {headerContent}
                        </button>
                      ) : (
                        headerContent
                      )}
                    </th>
                  );
                })}
                {hasActions && (
                  <th
                    scope="col"
                    className={`text-right ${cellPad} text-secondary w-24 font-medium`}
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
                    className="border-default hover:bg-surface-sunken border-b"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`${cellPad} ${
                          col.sticky
                            ? "bg-surface-primary sticky left-0 z-10"
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
                      <td className={`${cellPad} space-x-2 text-right`}>
                        {renderForm && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => {
                              setEditing(row);
                              setShowForm(true);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        {onDelete && (
                          <Button
                            variant="danger"
                            size="xs"
                            onClick={async () => {
                              if (await confirm("Delete this record?"))
                                onDelete(row.id);
                            }}
                            disabled={isDeleting}
                          >
                            Delete
                          </Button>
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
