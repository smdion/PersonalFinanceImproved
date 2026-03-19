"use client";

import { formatCurrency } from "@/lib/utils/format";

export type PushPreviewItem = {
  name: string;
  field: string;
  currentYnab: number;
  newValue: number;
};

export function PushPreviewModal({
  title,
  items,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string;
  items: PushPreviewItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  const changed = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) >= 0.01,
  );
  const unchanged = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) < 0.01,
  );

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 print:hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        className="bg-surface-primary rounded-lg shadow-xl border p-5 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
      >
        <h3 className="text-sm font-semibold text-primary mb-1">{title}</h3>
        <p className="text-xs text-muted mb-3">
          {changed.length === 0
            ? "No changes to push — all values match YNAB."
            : `${changed.length} item${changed.length !== 1 ? "s" : ""} will be updated in YNAB.`}
        </p>

        <div className="overflow-auto flex-1 mb-4">
          {changed.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b">
                  <th className="py-1.5 pr-2 font-medium">Item</th>
                  <th className="py-1.5 pr-2 font-medium">Field</th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    YNAB Now
                  </th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    New Value
                  </th>
                  <th className="py-1.5 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((item, i) => {
                  const delta = item.newValue - item.currentYnab;
                  return (
                    <tr key={i} className="border-b border-subtle">
                      <td
                        className="py-1.5 pr-2 text-secondary truncate max-w-[140px]"
                        title={item.name}
                      >
                        {item.name}
                      </td>
                      <td className="py-1.5 pr-2 text-muted">{item.field}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-muted">
                        {formatCurrency(item.currentYnab)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-medium text-primary">
                        {formatCurrency(item.newValue)}
                      </td>
                      <td
                        className={`py-1.5 text-right tabular-nums font-medium ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
                      >
                        {delta >= 0 ? "+" : ""}
                        {formatCurrency(delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {unchanged.length > 0 && (
            <p className="text-[10px] text-faint mt-2">
              {unchanged.length} item{unchanged.length !== 1 ? "s" : ""}{" "}
              unchanged (already match YNAB).
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted hover:bg-surface-elevated rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={changed.length === 0 || isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
          >
            {isPending
              ? "Pushing..."
              : `Push ${changed.length} Change${changed.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
