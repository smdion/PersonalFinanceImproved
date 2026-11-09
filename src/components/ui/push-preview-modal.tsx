"use client";

import { useEffect, useId, useState } from "react";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { CHANGE_DETECTION_THRESHOLD } from "@/lib/constants";
import { Button } from "./button";
import { Modal, ModalCancel } from "./modal";

export type PushPreviewItem = {
  name: string;
  field: string;
  currentYnab: number;
  newValue: number;
  /** A percentage-based goal whose stored amount differs from a live recalc (e.g. income
   *  changed), so the user can recalculate before pushing. */
  stale?: boolean;
};

export function PushPreviewModal({
  title,
  items,
  onConfirm,
  onCancel,
  isPending,
  direction = "push",
  destinationLabel = "your budget app",
  valueFormat = "currency",
}: {
  title: string;
  items: PushPreviewItem[];
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
  direction?: "push" | "pull" | "recalculate";
  destinationLabel?: string;
  /** How to render currentYnab/newValue/delta — "currency" (default) or
   *  "percent" for previews of allocation_percent changes. */
  valueFormat?: "currency" | "percent";
}) {
  const formatValue = (n: number) =>
    valueFormat === "percent" ? formatPercent(n / 100, 3) : formatCurrency(n);
  const changed = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) >= CHANGE_DETECTION_THRESHOLD,
  );
  const unchanged = items.filter(
    (i) => Math.abs(i.newValue - i.currentYnab) < CHANGE_DETECTION_THRESHOLD,
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

  const titleId = useId();
  // A push sends one request per item and can take over 30 seconds, so show elapsed time.
  // The parent unmounts this modal when the mutation settles, so each mount starts at 0
  // and setState happens only in the interval callback.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isPending) return;
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPending]);

  return (
    <Modal
      onClose={onCancel}
      role="alertdialog"
      labelledBy={titleId}
      busy={isPending}
      className="bg-surface-primary mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border p-5 shadow-xl"
    >
      <h3 id={titleId} className="text-primary mb-1 text-sm font-semibold">
        {title}
      </h3>
      <p className="text-muted mb-3 text-xs">
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
              Each item is a separate request to {destinationLabel}, so this can
              take 30 seconds or more — keep this window open until it finishes.
            </span>
          </>
        )}
      </p>

      {direction === "push" && staleItems.length > 0 && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-600">
          ⚠ {staleItems.length} percentage-based goal
          {staleItems.length !== 1 ? "s" : ""} below{" "}
          {staleItems.length !== 1 ? "don't" : "doesn't"} match current income —
          go to Savings and hit Recalculate first if you want the latest amount
          pushed.
        </p>
      )}

      <div className="mb-4 flex-1 overflow-auto">
        {changed.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b text-left">
                <th className="py-1.5 pr-2 font-medium">Item</th>
                <th className="py-1.5 pr-2 font-medium">Field</th>
                <th className="py-1.5 pr-2 text-right font-medium">
                  {beforeColumnLabel}
                </th>
                <th className="py-1.5 pr-2 text-right font-medium">
                  New Value
                </th>
                <th className="py-1.5 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((item) => {
                const delta = item.newValue - item.currentYnab;
                return (
                  <tr
                    key={`${item.name}-${item.field}`}
                    className="border-subtle border-b"
                  >
                    <td
                      className="text-secondary max-w-[140px] truncate py-1.5 pr-2"
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
                    <td className="text-muted py-1.5 pr-2">{item.field}</td>
                    <td className="text-muted py-1.5 pr-2 text-right tabular-nums">
                      {formatValue(item.currentYnab)}
                    </td>
                    <td className="text-primary py-1.5 pr-2 text-right font-medium tabular-nums">
                      {formatValue(item.newValue)}
                    </td>
                    <td
                      className={`py-1.5 text-right font-medium tabular-nums ${delta >= 0 ? "text-green-600" : "text-red-600"}`}
                    >
                      {delta >= 0 ? "+" : ""}
                      {formatValue(delta)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {unchanged.length > 0 && (
          <p className="text-caption text-faint mt-2">
            {unchanged.length} item{unchanged.length !== 1 ? "s" : ""} unchanged
            (already match {applyTarget}).
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <ModalCancel>
          <Button
            variant="ghost"
            title={
              isPending
                ? "Already in progress — closing this won't stop it"
                : undefined
            }
          >
            Cancel
          </Button>
        </ModalCancel>
        <Button
          variant="primary"
          onClick={onConfirm}
          disabled={changed.length === 0 || isPending}
        >
          {isPending
            ? `${pendingVerb} (${elapsedSeconds}s)`
            : `${actionVerb} ${changed.length} Change${changed.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </Modal>
  );
}
