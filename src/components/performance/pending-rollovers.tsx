"use client";

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency, accountDisplayName } from "@/lib/utils/format";

type PendingRollover = {
  id: number;
  sourceAccountPerformanceId: number;
  destinationPerformanceAccountId: number;
  amount: number;
  saleDate: string;
  saleYear: number;
  applyYear: number;
  notes: string | null;
  createdAt: string;
};

type MasterAccount = {
  id: number;
  institution: string;
  accountLabel: string;
};

type AccountRow = {
  id: number;
  accountLabel: string;
  institution: string;
  performanceAccountId: number | null;
  year: number;
};

type Props = {
  pendingRollovers: PendingRollover[];
  accountRows: AccountRow[];
  masterAccounts: MasterAccount[];
  onMutated: () => void;
};

export function PendingRollovers({
  pendingRollovers,
  accountRows,
  masterAccounts,
  onMutated,
}: Props) {
  if (pendingRollovers.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <svg
          aria-hidden="true"
          className="w-4 h-4 text-amber-500 flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
        </svg>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          {pendingRollovers.length} Pending Rollover
          {pendingRollovers.length > 1 ? "s" : ""}
        </span>
        <span className="text-[10px] text-faint">
          — confirm when wire has cleared in destination account
        </span>
      </div>

      <div className="space-y-1.5">
        {pendingRollovers.map((pr) => (
          <PendingRolloverRow
            key={pr.id}
            rollover={pr}
            accountRows={accountRows}
            masterAccounts={masterAccounts}
            onMutated={onMutated}
          />
        ))}
      </div>
    </div>
  );
}

function PendingRolloverRow({
  rollover,
  accountRows,
  masterAccounts,
  onMutated,
}: {
  rollover: PendingRollover;
  accountRows: AccountRow[];
  masterAccounts: MasterAccount[];
  onMutated: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [actualAmount, setActualAmount] = useState(rollover.amount.toFixed(2));
  const [deleting, setDeleting] = useState(false);

  const utils = trpc.useUtils();

  const confirmMutation = trpc.performance.confirmPendingRollover.useMutation({
    onSuccess: () => {
      setConfirming(false);
      void utils.performance.computeSummary.invalidate();
      onMutated();
    },
  });

  const deleteMutation = trpc.performance.deletePendingRollover.useMutation({
    onSuccess: () => {
      setDeleting(false);
      void utils.performance.computeSummary.invalidate();
      onMutated();
    },
  });

  // Resolve display names
  const srcRow = accountRows.find(
    (a) => a.id === rollover.sourceAccountPerformanceId,
  );
  const destMaster = masterAccounts.find(
    (m) => m.id === rollover.destinationPerformanceAccountId,
  );

  const srcLabel = srcRow
    ? accountDisplayName(srcRow)
    : `Account #${rollover.sourceAccountPerformanceId}`;
  const destLabel = destMaster
    ? accountDisplayName(destMaster)
    : `Account #${rollover.destinationPerformanceAccountId}`;

  const yearNote =
    rollover.saleYear !== rollover.applyYear
      ? ` (sale ${rollover.saleYear} → applies ${rollover.applyYear})`
      : ` (${rollover.saleYear})`;

  if (confirming) {
    return (
      <div className="rounded border border-amber-400/60 bg-white dark:bg-neutral-900 p-2.5 space-y-2">
        <p className="text-xs font-semibold text-primary">Confirm rollover</p>
        <div className="text-[11px] text-muted space-y-0.5">
          <div>
            <span className="font-medium">From:</span> {srcLabel}
          </div>
          <div>
            <span className="font-medium">To:</span> {destLabel}
          </div>
          <div>
            <span className="font-medium">Sale date:</span> {rollover.saleDate}
            {yearNote}
          </div>
        </div>
        <div className="text-[11px] text-muted space-y-1">
          <p>
            Confirm the actual wire amount (edit if it differs from recorded):
          </p>
          <div className="flex items-center border border-default rounded w-32 focus-within:ring-1 focus-within:ring-amber-500">
            <span className="pl-2 text-xs text-muted select-none">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={actualAmount}
              onChange={(e) => setActualAmount(e.target.value)}
              className="flex-1 bg-transparent px-1 py-0.5 text-xs text-right text-primary focus:outline-none"
            />
          </div>
        </div>
        <p className="text-[10px] text-faint">
          This will: reduce {srcLabel} ending balance by{" "}
          {formatCurrency(parseFloat(actualAmount) || 0)}, record rollover out.
          Add rollover in + ending balance to {destLabel} for{" "}
          {rollover.applyYear}.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="px-2 py-1 text-xs text-muted border border-strong rounded hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmMutation.isPending}
            onClick={() =>
              confirmMutation.mutate({
                id: rollover.id,
                actualAmount:
                  actualAmount !== rollover.amount.toFixed(2)
                    ? actualAmount
                    : undefined,
              })
            }
            className="px-3 py-1 text-xs text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-50"
          >
            {confirmMutation.isPending
              ? "Confirming..."
              : "Confirm — apply now"}
          </button>
        </div>
        {confirmMutation.isError && (
          <p className="text-xs text-red-600">
            {confirmMutation.error.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded border border-amber-300/40 bg-white/60 dark:bg-neutral-900/40 px-2.5 py-1.5 text-xs">
      <div className="flex-1 min-w-0">
        <span className="font-semibold tabular-nums text-amber-700 dark:text-amber-400">
          {formatCurrency(rollover.amount)}
        </span>
        <span className="text-muted mx-1.5">·</span>
        <span className="text-muted truncate">
          {srcLabel} → {destLabel}
        </span>
        <span className="text-faint ml-1.5">{rollover.saleDate}</span>
        {rollover.notes && (
          <span className="text-faint ml-1.5 italic">{rollover.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[10px] text-amber-600 hover:text-amber-800 font-medium border border-amber-400/50 rounded px-1.5 py-0.5"
        >
          Confirm received
        </button>
        {!deleting ? (
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="text-[10px] text-faint hover:text-red-500"
          >
            cancel
          </button>
        ) : (
          <span className="flex items-center gap-1 text-[10px]">
            <span className="text-red-600">Delete?</span>
            <button
              type="button"
              onClick={() => deleteMutation.mutate({ id: rollover.id })}
              disabled={deleteMutation.isPending}
              className="text-red-600 hover:text-red-800 font-medium"
            >
              yes
            </button>
            <button
              type="button"
              onClick={() => setDeleting(false)}
              className="text-muted"
            >
              no
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/** Small badge shown on individual account rows in the performance table. */
export function PendingRolloverBadge({
  accountPerformanceId,
  pendingRollovers,
  direction,
}: {
  accountPerformanceId: number;
  pendingRollovers: PendingRollover[];
  direction: "out" | "in";
}) {
  const relevant =
    direction === "out"
      ? pendingRollovers.filter(
          (pr) => pr.sourceAccountPerformanceId === accountPerformanceId,
        )
      : pendingRollovers.filter(
          (pr) => pr.destinationPerformanceAccountId === accountPerformanceId,
        );

  if (relevant.length === 0) return null;

  const total = relevant.reduce((s, pr) => s + pr.amount, 0);
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-600 border border-amber-400/50 rounded px-1 py-0.5 ml-1">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
      {direction === "out" ? "−" : "+"}
      {formatCurrency(total)} pending
    </span>
  );
}
