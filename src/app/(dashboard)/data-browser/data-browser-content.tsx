"use client";

/** Client content for the Data Browser page — prefetched by page.tsx. */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatNumber } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-faint text-xs italic">null</span>;
  }
  if (typeof value === "object") {
    return (
      <details className="inline">
        <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-800">
          JSON
        </summary>
        <pre className="bg-surface-sunken mt-1 max-w-md overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    );
  }
  if (typeof value === "boolean") {
    return (
      <span
        className={`text-xs font-medium ${value ? "text-green-600" : "text-red-500"}`}
      >
        {String(value)}
      </span>
    );
  }
  const str = String(value);
  if (str.length > 100) {
    return (
      <span title={str} className="text-sm">
        {str.slice(0, 100)}...
      </span>
    );
  }
  return <span className="text-sm">{str}</span>;
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    integer: "bg-blue-100 text-blue-700",
    bigint: "bg-blue-100 text-blue-700",
    text: "bg-green-100 text-green-700",
    jsonb: "bg-purple-100 text-purple-700",
    json: "bg-purple-100 text-purple-700",
    boolean: "bg-yellow-100 text-yellow-700",
    real: "bg-orange-100 text-orange-700",
    numeric: "bg-orange-100 text-orange-700",
    "double precision": "bg-orange-100 text-orange-700",
    "timestamp without time zone": "bg-pink-100 text-pink-700",
    timestamp: "bg-pink-100 text-pink-700",
  };
  const color =
    colors[type.toLowerCase()] ?? "bg-surface-strong text-secondary";
  return (
    <span className={`text-caption rounded px-1.5 py-0.5 font-mono ${color}`}>
      {type}
    </span>
  );
}

export function DataBrowserContent() {
  const user = useUser();
  const admin = isAdmin(user);
  const [selectedTable, setSelectedTable] = usePersistedSetting<string>(
    "data_browser_table",
    "",
  );
  const [tableFilter, setTableFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const tablesQuery = trpc.dataBrowser.listTables.useQuery(undefined, {
    enabled: admin,
  });
  const columnsQuery = trpc.dataBrowser.getColumns.useQuery(
    { tableName: selectedTable },
    { enabled: admin && !!selectedTable },
  );
  const rowsQuery = trpc.dataBrowser.getRows.useQuery(
    { tableName: selectedTable, limit: pageSize, offset: page * pageSize },
    { enabled: admin && !!selectedTable },
  );

  if (!admin) {
    return (
      <div>
        <PageHeader title="Raw Data" />
        <p className="text-muted">Admin access required.</p>
      </div>
    );
  }

  const tables = tablesQuery.data ?? [];
  const filteredTables = tableFilter
    ? tables.filter((t) =>
        t.tableName.toLowerCase().includes(tableFilter.toLowerCase()),
      )
    : tables;
  const totalRows = tables.reduce(
    (sum, t) => sum + (t.rowCount > 0 ? t.rowCount : 0),
    0,
  );
  const columns = columnsQuery.data ?? [];
  const rows = rowsQuery.data?.rows ?? [];
  const totalCount = rowsQuery.data?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const handleExportJson = async () => {
    if (!selectedTable || !rowsQuery.data) return;
    // Use current page data for quick export, or fetch all
    const blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedTable}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Raw Data"
        subtitle="Live database table browser (read-only, admin only)"
      />

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* Left panel — table list */}
        <div className="w-64 shrink-0 overflow-hidden rounded-lg border">
          <div className="bg-surface-sunken border-b px-3 py-2">
            <input
              type="text"
              placeholder="Filter tables..."
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="bg-surface-primary w-full rounded border px-2 py-1 text-sm"
            />
            <p className="text-faint mt-1 text-xs">
              {tables.length} tables &middot; {formatNumber(totalRows)} rows
            </p>
          </div>
          <div
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100vh - 300px)" }}
          >
            {tablesQuery.isLoading ? (
              <div className="text-muted p-3 text-sm">Loading...</div>
            ) : (
              filteredTables.map((t) => (
                <button
                  key={t.tableName}
                  onClick={() => {
                    setSelectedTable(t.tableName);
                    setPage(0);
                  }}
                  className={`border-subtle flex w-full items-center justify-between border-b px-3 py-1.5 text-left text-sm transition-colors ${
                    selectedTable === t.tableName
                      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                      : "hover:bg-surface-elevated"
                  }`}
                >
                  <span className="truncate font-mono text-xs">
                    {t.tableName}
                  </span>
                  <span
                    className={`ml-2 shrink-0 text-xs ${
                      t.rowCount < 0
                        ? "text-red-400"
                        : t.rowCount === 0
                          ? "text-faint"
                          : "text-muted"
                    }`}
                  >
                    {t.rowCount < 0 ? "err" : t.rowCount}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right panel — table viewer */}
        <div className="min-w-0 flex-1">
          {!selectedTable ? (
            <div className="text-muted flex h-full items-center justify-center text-sm">
              Select a table to browse its contents
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-mono text-lg font-semibold">
                    {selectedTable}
                  </h2>
                  <p className="text-muted text-xs">
                    {formatNumber(totalCount)} rows &middot; {columns.length}{" "}
                    columns
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportJson}
                    className="hover:bg-surface-elevated rounded border px-3 py-1 text-sm transition-colors"
                  >
                    Export JSON
                  </button>
                </div>
              </div>

              {/* Column metadata */}
              {columns.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {columns.map((col) => (
                    <span
                      key={col.name}
                      className="bg-surface-elevated inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs"
                      title={`${col.name}: ${col.type}${col.nullable ? " (nullable)" : ""}${col.defaultValue ? ` default: ${col.defaultValue}` : ""}`}
                    >
                      <span className="font-mono">{col.name}</span>
                      <TypeBadge type={col.type} />
                    </span>
                  ))}
                </div>
              )}

              {/* Data table */}
              {rowsQuery.isLoading ? (
                <div className="text-muted text-sm">Loading rows...</div>
              ) : rows.length === 0 ? (
                <div className="text-muted rounded border p-4 text-center text-sm">
                  No rows in this table
                </div>
              ) : (
                <div className="overflow-auto rounded-lg border">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-sunken">
                        {columns.map((col) => (
                          <th
                            key={col.name}
                            className="text-muted border-b px-3 py-2 text-left text-xs font-medium whitespace-nowrap"
                          >
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={String((row as Record<string, unknown>).id ?? i)}
                          className="border-subtle hover:bg-surface-elevated/50 border-b"
                        >
                          {columns.map((col) => (
                            <td
                              key={col.name}
                              className="max-w-xs px-3 py-1.5 whitespace-nowrap"
                            >
                              <CellValue value={row[col.name]} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-muted text-xs">
                    Showing {page * pageSize + 1}–
                    {Math.min((page + 1) * pageSize, totalCount)} of{" "}
                    {formatNumber(totalCount)}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="hover:bg-surface-elevated rounded border px-3 py-1 text-sm transition-colors disabled:opacity-30"
                    >
                      Prev
                    </button>
                    <span className="text-muted text-xs">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages - 1, p + 1))
                      }
                      disabled={page >= totalPages - 1}
                      className="hover:bg-surface-elevated rounded border px-3 py-1 text-sm transition-colors disabled:opacity-30"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
