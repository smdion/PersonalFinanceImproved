"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils/format";

export type PushPreviewItem = {
  name: string;
  field: string;
  currentYnab: number;
  newValue: number;
  /** True when this is a percentage-based savings goal whose stored amount
   *  no longer matches what a live recalc would produce (e.g. income
   *  changed since it was last recalculated) — surfaced so the user can
   *  go recalculate before pushing an outdated number. */
  stale?: boolean;
};

export function PushPreviewModal({
  title,
  items,
  onConfirm,
  onCancel,
  isPending,
  direction = "push",
  destinationLabel = "YNAB",
}: {
  title: string;
  items: PushPreviewItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  direction?: "push" | "pull" | "recalculate";
  destinationLabel?: string;
}) {
  const changed = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) >= 0.01,
  );
  const unchanged = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) < 0.01,
  );
  const staleItems = items.filter((i) => i.stale);
  const isPull = direction === "pull";
  const isRecalculate = direction === "recalculate";
  const beforeColumnLabel = isRecalculate
    ? "Current"
    : isPull
      ? "Ledgr Now"
      : `${destinationLabel} Now`;
  const applyTarget = isRecalculate
    ? "the live calculation"
    : isPull
      ? "Ledgr"
      : destinationLabel;
  const actionVerb = isRecalculate ? "Recalculate" : isPull ? "Pull" : "Push";
  const pendingVerb = isRecalculate
    ? "Recalculating..."
    : isPull
      ? "Pulling..."
      : "Pushing...";

  // Push sends one request per changed item to YNAB, so a full push can
  // take well over 30 seconds — show elapsed time so it's clear the app is
  // still working, not stuck. setState only ever happens from the
  // interval's own callback (never synchronously in the effect body) — the
  // parent unmounts this modal once the mutation settles (see
  // BudgetPushYnabModal/BudgetPullYnabModal), so a fresh mount next time
  // already starts elapsedSeconds back at 0 with no explicit reset needed.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isPending) return;
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPending]);

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
            ? isRecalculate
              ? "No changes — all goals already match the live calculation."
              : `No changes to ${actionVerb.toLowerCase()} — all values match ${applyTarget}.`
            : isRecalculate
              ? `${changed.length} goal${changed.length !== 1 ? "s" : ""} will be recalculated from ${applyTarget}.`
              : `${changed.length} item${changed.length !== 1 ? "s" : ""} will be updated in ${applyTarget}.`}
          {direction === "push" && changed.length > 0 && (
            <>
              {" "}
              <span className="text-faint">
                Each item is a separate request to YNAB, so this can take 30
                seconds or more — keep this window open until it finishes.
              </span>
            </>
          )}
        </p>

        {direction === "push" && staleItems.length > 0 && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
            ⚠ {staleItems.length} percentage-based goal
            {staleItems.length !== 1 ? "s" : ""} below{" "}
            {staleItems.length !== 1 ? "don't" : "doesn't"} match current income
            — go to Savings and hit Recalculate first if you want the latest
            amount pushed.
          </p>
        )}

        <div className="overflow-auto flex-1 mb-4">
          {changed.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b">
                  <th className="py-1.5 pr-2 font-medium">Item</th>
                  <th className="py-1.5 pr-2 font-medium">Field</th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    {beforeColumnLabel}
                  </th>
                  <th className="py-1.5 pr-2 font-medium text-right">
                    New Value
                  </th>
                  <th className="py-1.5 font-medium text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((item) => {
                  const delta = item.newValue - item.currentYnab;
                  return (
                    <tr
                      key={`${item.name}-${item.field}`}
                      className="border-b border-subtle"
                    >
                      <td
                        className="py-1.5 pr-2 text-secondary truncate max-w-[140px]"
                        title={item.name}
                      >
                        {item.name}
                        {item.stale && (
                          <span
                            className="ml-1 text-amber-600"
                            title="Stale vs. current income — recalculate before pushing"
                          >
                            ⚠
                          </span>
                        )}
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
            <p className="text-caption text-faint mt-2">
              {unchanged.length} item{unchanged.length !== 1 ? "s" : ""}{" "}
              unchanged (already match {applyTarget}).
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            title={
              isPending
                ? "Already in progress — closing this won't stop it"
                : undefined
            }
            className="px-3 py-1.5 text-sm text-muted hover:bg-surface-elevated rounded transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={changed.length === 0 || isPending}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
          >
            {isPending
              ? `${pendingVerb} (${elapsedSeconds}s)`
              : `${actionVerb} ${changed.length} Change${changed.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
