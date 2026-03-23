"use client";

/** Generic CRUD data table component with column rendering, inline add/edit forms, and row deletion — used by settings tabs like People. */
import { useState } from "react";
import { confirm } from "@/components/ui/confirm-dialog";

type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
};

type Props<T extends { id: number }> = {
  title: string;
  columns: Column<T>[];
  data: T[] | undefined;
  isLoading: boolean;
  onDelete?: (id: number) => void;
  isDeleting?: boolean;
  renderForm?: (editing: T | null, onClose: () => void) => React.ReactNode;
};

export function DataTable<T extends { id: number }>({
  title,
  columns,
  data,
  isLoading,
  onDelete,
  isDeleting,
  renderForm,
}: Props<T>) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);

  if (isLoading) {
    return <div className="text-muted">Loading {title.toLowerCase()}...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {renderForm && (
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Add
          </button>
        )}
      </div>

      {showForm && renderForm && (
        <div className="mb-4 p-4 bg-surface-sunken rounded border">
          {renderForm(editing, () => {
            setShowForm(false);
            setEditing(null);
          })}
        </div>
      )}

      {!data || data.length === 0 ? (
        <p className="text-muted text-sm">
          No {title.toLowerCase()} configured.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-surface-sunken">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left px-3 py-2 font-medium text-secondary"
                  >
                    {col.label}
                  </th>
                ))}
                {(onDelete || renderForm) && (
                  <th className="text-right px-3 py-2 font-medium text-secondary w-24">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="border-b hover:bg-surface-sunken">
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2">
                      {col.render
                        ? col.render(row)
                        : String(
                            (row as Record<string, unknown>)[col.key] ?? "",
                          )}
                    </td>
                  ))}
                  {(onDelete || renderForm) && (
                    <td className="px-3 py-2 text-right space-x-2">
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
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
