"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils/format";

interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
  transferPairId?: string | null;
}

function TransactionRow({
  tx,
  goalName,
  isPast,
  onDelete,
  canEdit,
}: {
  tx: PlannedTransaction;
  goalName: string;
  isPast: boolean;
  onDelete: () => void;
  canEdit?: boolean;
}) {
  return (
    <tr className={`border-b border-subtle ${isPast ? "opacity-60" : ""}`}>
      <td className="py-1.5 text-secondary">{goalName}</td>
      <td className="py-1.5 text-muted">
        {formatDate(tx.transactionDate, "medium")}
      </td>
      <td className="py-1.5 text-secondary">
        {tx.transferPairId && (
          <span className="text-[9px] font-medium text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded mr-1.5">
            Transfer
          </span>
        )}
        {tx.description}
      </td>
      <td
        className={`py-1.5 text-right font-medium ${tx.amount < 0 ? "text-red-600" : "text-green-600"}`}
      >
        {tx.amount >= 0 ? "+" : ""}
        {formatCurrency(tx.amount)}
      </td>
      <td className="py-1.5 text-muted">
        {tx.isRecurring ? `Every ${tx.recurrenceMonths} mo` : "\u2014"}
      </td>
      <td className="py-1.5">
        {canEdit !== false && (
          <button
            onClick={onDelete}
            className="text-red-600 hover:text-red-600 text-xs"
            title="Delete"
          >
            &times;
          </button>
        )}
      </td>
    </tr>
  );
}

function TransactionTable({
  transactions,
  goalById,
  onDeleteTx,
  isPast,
  entityLabel,
  canEdit,
}: {
  transactions: PlannedTransaction[];
  goalById: Map<number, { name: string }>;
  onDeleteTx: (params: { id: number }) => void;
  isPast: boolean;
  entityLabel: string;
  canEdit?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-muted text-xs">
          <th className="text-left py-1.5">{entityLabel}</th>
          <th className="text-left py-1.5">Date</th>
          <th className="text-left py-1.5">Description</th>
          <th className="text-right py-1.5">Amount</th>
          <th className="text-left py-1.5">Recurring</th>
          {canEdit !== false && <th className="py-1.5 w-8"></th>}
        </tr>
      </thead>
      <tbody>
        {transactions.map((tx) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            goalName={goalById.get(tx.goalId)?.name ?? `#${tx.goalId}`}
            isPast={isPast}
            onDelete={() => onDeleteTx({ id: tx.id })}
            canEdit={canEdit}
          />
        ))}
      </tbody>
    </table>
  );
}

export function PlannedEventsTab({
  plannedTransactions,
  goalById,
  onDeleteTx,
  entityLabel = "Fund",
  canEdit,
}: {
  plannedTransactions: PlannedTransaction[];
  goalById: Map<number, { name: string }>;
  onDeleteTx: (params: { id: number }) => void;
  entityLabel?: string;
  canEdit?: boolean;
}) {
  const [showPast, setShowPast] = useState(false);

  if (plannedTransactions.length === 0) {
    return (
      <EmptyState
        message="No transactions yet."
        hint="Add planned deposits or withdrawals from the Projections tab."
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...plannedTransactions].sort((a, b) =>
    a.transactionDate.localeCompare(b.transactionDate),
  );
  const upcoming = sorted.filter((tx) => tx.transactionDate >= today);
  const past = sorted.filter((tx) => tx.transactionDate < today);

  return (
    <div className="space-y-4">
      {/* Upcoming */}
      <Card title={`Upcoming (${upcoming.length})`} className="mb-0">
        {upcoming.length > 0 ? (
          <TransactionTable
            transactions={upcoming}
            goalById={goalById}
            onDeleteTx={onDeleteTx}
            isPast={false}
            entityLabel={entityLabel}
            canEdit={canEdit}
          />
        ) : (
          <p className="text-sm text-faint py-2">No upcoming transactions.</p>
        )}
      </Card>

      {/* Past */}
      {past.length > 0 && (
        <div>
          <button
            onClick={() => setShowPast(!showPast)}
            className="text-sm text-muted hover:text-secondary mb-2 flex items-center gap-1"
          >
            <span className="text-xs">{showPast ? "&#9660;" : "&#9654;"}</span>
            Completed ({past.length})
          </button>
          {showPast && (
            <Card className="mb-0">
              <TransactionTable
                transactions={past}
                goalById={goalById}
                onDeleteTx={onDeleteTx}
                isPast={true}
                entityLabel={entityLabel}
                canEdit={canEdit}
              />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
