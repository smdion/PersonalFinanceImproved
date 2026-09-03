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
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {renderForm && (
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            Add
          </button>
        )}
      </div>

      {showForm && renderForm && (
        <div className="bg-surface-sunken mb-4 rounded border p-4">
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
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-sunken border-b">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-secondary px-3 py-2 text-left font-medium"
                  >
                    {col.label}
                  </th>
                ))}
                {(onDelete || renderForm) && (
                  <th className="text-secondary w-24 px-3 py-2 text-right font-medium">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id} className="hover:bg-surface-sunken border-b">
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
                    <td className="space-x-2 px-3 py-2 text-right">
                      {renderForm && (
                        <button
                          onClick={() => {
                            setEditing(row);
                            setShowForm(true);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800"
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
                          className="text-xs text-red-600 hover:text-red-800"
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
