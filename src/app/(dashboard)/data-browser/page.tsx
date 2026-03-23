"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatNumber } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-faint italic">null</span>;
  }
  if (typeof value === "object") {
    return (
      <details className="inline">
        <summary className="cursor-pointer text-xs text-blue-600 hover:text-blue-800">
          JSON
        </summary>
        <pre className="text-xs mt-1 p-2 bg-surface-sunken rounded max-w-md overflow-auto whitespace-pre-wrap">
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
  const color = colors[type.toLowerCase()] ?? "bg-gray-100 text-gray-700";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${color}`}>
      {type}
    </span>
  );
}

export default function DataBrowserPage() {
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
        <div className="w-64 shrink-0 border rounded-lg overflow-hidden">
          <div className="bg-surface-sunken px-3 py-2 border-b">
            <input
              type="text"
              placeholder="Filter tables..."
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="w-full px-2 py-1 text-sm border rounded bg-surface-primary"
            />
            <p className="text-xs text-faint mt-1">
              {tables.length} tables &middot; {formatNumber(totalRows)} rows
            </p>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
            {tablesQuery.isLoading ? (
              <div className="p-3 text-sm text-muted">Loading...</div>
            ) : (
              filteredTables.map((t) => (
                <button
                  key={t.tableName}
                  onClick={() => {
                    setSelectedTable(t.tableName);
                    setPage(0);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm border-b border-subtle flex items-center justify-between transition-colors ${
                    selectedTable === t.tableName
                      ? "bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-300"
                      : "hover:bg-surface-elevated"
                  }`}
                >
                  <span className="font-mono text-xs truncate">
                    {t.tableName}
                  </span>
                  <span
                    className={`text-xs shrink-0 ml-2 ${
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
        <div className="flex-1 min-w-0">
          {!selectedTable ? (
            <div className="flex items-center justify-center h-full text-muted text-sm">
              Select a table to browse its contents
            </div>
          ) : (
            <div>
              {/* Table header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold font-mono">
                    {selectedTable}
                  </h2>
                  <p className="text-xs text-muted">
                    {formatNumber(totalCount)} rows &middot;{" "}
                    {columns.length} columns
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportJson}
                    className="px-3 py-1 text-sm border rounded hover:bg-surface-elevated transition-colors"
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
                      className="inline-flex items-center gap-1 text-xs bg-surface-elevated px-2 py-0.5 rounded"
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
                <div className="text-sm text-muted">Loading rows...</div>
              ) : rows.length === 0 ? (
                <div className="text-sm text-muted p-4 text-center border rounded">
                  No rows in this table
                </div>
              ) : (
                <div className="border rounded-lg overflow-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-surface-sunken">
                        {columns.map((col) => (
                          <th
                            key={col.name}
                            className="text-left px-3 py-2 text-xs font-medium text-muted whitespace-nowrap border-b"
                          >
                            {col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr
                          key={i}
                          className="border-b border-subtle hover:bg-surface-elevated/50"
                        >
                          {columns.map((col) => (
                            <td
                              key={col.name}
                              className="px-3 py-1.5 whitespace-nowrap max-w-xs"
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
                <div className="flex items-center justify-between mt-3">
                  <p className="text-xs text-muted">
                    Showing {page * pageSize + 1}–
                    {Math.min((page + 1) * pageSize, totalCount)} of{" "}
                    {formatNumber(totalCount)}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-30 hover:bg-surface-elevated transition-colors"
                    >
                      Prev
                    </button>
                    <span className="text-xs text-muted">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() =>
                        setPage((p) => Math.min(totalPages - 1, p + 1))
                      }
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1 text-sm border rounded disabled:opacity-30 hover:bg-surface-elevated transition-colors"
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
