"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useLocalStorage } from "@/lib/hooks/use-local-storage";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { FUND_COLORS } from "@/lib/utils/colors";
import {
  buildSettledOccurrencesSet,
  type PlannedTransaction,
} from "@/lib/pure/savings/savings-projection";
import type { GoalProjection } from "../types";
import { SettlementSuggestions, TransactionsToolbar } from "./filters";
import {
  TransactionAmountFields,
  TransactionDetailFields,
  TransferDetailFields,
  TransferRouteFields,
  defaultAddForm,
  defaultTransferForm,
} from "./editor";
import {
  HistoryRowCells,
  TransactionsTableHead,
  UpcomingActionsCell,
  UpcomingAmountCells,
  UpcomingDateAndDescriptionCells,
  UpcomingFundCell,
  type EditForm,
} from "./row";

type ActiveCellField = "goalId" | "transactionDate" | "description" | "amount";
const ADD_MODES = [
  { value: "transaction", label: "Transaction" },
  { value: "transfer", label: "Transfer" },
] as const;

export function AllTransactionsTab({
  plannedTransactions,
  goalProjections,
  canEdit,
  projectionEndDate,
  hiddenGoalIds,
}: {
  plannedTransactions: PlannedTransaction[];
  goalProjections: GoalProjection[];
  canEdit?: boolean;
  projectionEndDate?: Date;
  hiddenGoalIds?: Set<number>;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"transaction" | "transfer">(
    "transaction",
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [historyWindow, setHistoryWindow] = useLocalStorage<
    0 | 3 | 6 | 12 | "all"
  >("ledgr:savings:txHistoryWindow", 0);
  const [tableLocked, setTableLocked] = useLocalStorage<boolean>(
    "ledgr:savings:txLocked",
    true,
  );
  const [showRuleTx, setShowRuleTx] = useLocalStorage<boolean>(
    "ledgr:savings:showRuleTx",
    false,
  );
  const [addForm, setAddForm] = useState({
    ...defaultAddForm,
    goalId: goalProjections[0]?.goalId ?? 0,
  });
  const [transferForm, setTransferForm] = useState({
    ...defaultTransferForm,
    fromGoalId: goalProjections[0]?.goalId ?? 0,
  });
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [activeCell, setActiveCell] = useState<{
    id: number;
    field: ActiveCellField;
  } | null>(null);

  // An inline edit ends once: Enter's save records the edit it ended (each
  // activation is a new activeCell), so that edit's blur doesn't save again.
  const committed = useRef<typeof activeCell>(null);

  const createTx = trpc.savings.plannedTransactions.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setAdding(false);
      setAddForm({
        ...defaultAddForm,
        goalId: goalProjections[0]?.goalId ?? 0,
      });
    },
  });
  const createTransfer = trpc.savings.transfers.create.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setAdding(false);
      setTransferForm({
        ...defaultTransferForm,
        fromGoalId: goalProjections[0]?.goalId ?? 0,
      });
    },
  });
  const updateTx = trpc.savings.plannedTransactions.update.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setEditingId(null);
      setEditForm(null);
    },
  });
  const deleteTx = trpc.savings.plannedTransactions.delete.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setActiveCell(null);
    },
  });
  const deleteTransfer = trpc.savings.transfers.delete.useMutation({
    onSuccess: () => {
      utils.savings.invalidate();
      setActiveCell(null);
    },
  });
  const settleTx = trpc.savings.plannedTransactions.settle.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const settleMany = trpc.savings.plannedTransactions.settleMany.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const { data: suggestionsData } =
    trpc.savings.plannedTransactions.getSettlementSuggestions.useQuery();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set(),
  );
  const settledOccurrences = buildSettledOccurrencesSet(plannedTransactions);
  const plannedTxById = new Map(plannedTransactions.map((tx) => [tx.id, tx]));
  const suggestions = (suggestionsData?.suggestions ?? []).filter(
    (s) => !dismissedSuggestions.has(`${s.plannedTxId}:${s.occurrenceMonth}`),
  );

  const fundColorMap = new Map(
    goalProjections.map((gp, i) => [
      gp.goalId,
      FUND_COLORS[i % FUND_COLORS.length],
    ]),
  );
  const fundNameMap = new Map(
    goalProjections.map((gp) => [gp.goalId, gp.name]),
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Age-based nudge for what the sync-presence suggestions can't see:
  // non-API-linked goals and rows older than the sync's lookback window.
  const AGE_NUDGE_MONTHS = 2;
  const monthsAgo = (dateStr: string): number => {
    const d = new Date(dateStr + "T00:00:00");
    return (
      (today.getFullYear() - d.getFullYear()) * 12 +
      (today.getMonth() - d.getMonth())
    );
  };

  // Show all upcoming transactions including transfers (deduped: only show one leg per pair)
  // Clipped to the projection window end date when provided.
  // Rule-generated rows hidden by default unless showRuleTx is on.
  const seenPairs = new Set<string>();
  const upcoming = plannedTransactions
    .filter((tx) => {
      if (hiddenGoalIds?.has(tx.goalId)) return false;
      if (tx.source === "rule" && !showRuleTx) return false;
      const date = new Date(tx.transactionDate + "T00:00:00");
      if (!tx.isRecurring && date < today) return false;
      if (projectionEndDate && !tx.isRecurring && date > projectionEndDate)
        return false;
      if (tx.transferPairId) {
        if (seenPairs.has(tx.transferPairId)) return false;
        seenPairs.add(tx.transferPairId);
      }
      return true;
    })
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  // "After" balance: use the pre-computed GoalProjection.balances[] which already
  // includes contributions, recurring expansion, and overrides — matching the Goals table.
  // Map from goalId for O(1) lookup.
  const gpByGoalId = new Map(goalProjections.map((gp) => [gp.goalId, gp]));
  // GoalProjection.balances[0] is the current calendar month, as built by
  // savings-content.tsx's monthDates; this index math must match it.
  const projectionStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const getBalanceAfter = (
    goalId: number,
    dateStr: string,
  ): number | undefined => {
    const gp = gpByGoalId.get(goalId);
    if (!gp) return undefined;
    const d = new Date(dateStr + "T00:00:00");
    const mi =
      (d.getFullYear() - projectionStart.getFullYear()) * 12 +
      (d.getMonth() - projectionStart.getMonth());
    if (mi < 0 || mi >= gp.balances.length) return undefined;
    return gp.balances[mi];
  };

  // Past non-recurring transactions for the history window.
  const historyWindowStart =
    historyWindow === 0
      ? null
      : historyWindow === "all"
        ? new Date(0)
        : (() => {
            const d = new Date(today);
            d.setMonth(d.getMonth() - historyWindow);
            return d;
          })();

  const seenHistPairs = new Set<string>();
  const past =
    historyWindowStart === null
      ? []
      : plannedTransactions
          .filter((tx) => {
            if (hiddenGoalIds?.has(tx.goalId)) return false;
            if (tx.source === "rule" && !showRuleTx) return false;
            if (tx.isRecurring) return false;
            const date = new Date(tx.transactionDate + "T00:00:00");
            if (date >= today) return false;
            if (date < historyWindowStart) return false;
            if (tx.transferPairId) {
              if (seenHistPairs.has(tx.transferPairId)) return false;
              seenHistPairs.add(tx.transferPairId);
            }
            return true;
          })
          .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate)); // newest first

  const startEdit = (tx: PlannedTransaction) => {
    setEditingId(tx.id);
    setEditForm({
      goalId: tx.goalId,
      transactionDate: tx.transactionDate,
      description: tx.description,
      amount: String(Math.abs(tx.amount)),
      isRecurring: tx.isRecurring,
      recurrenceMonths: tx.recurrenceMonths ?? 1,
    });
  };

  const activateCell = (tx: PlannedTransaction, field: ActiveCellField) => {
    if (tableLocked) return;
    // Initialize editForm for this row only when switching rows.
    // Blur on the departing cell commits before activateCell fires on the new cell.
    if (editingId !== tx.id) startEdit(tx);
    setActiveCell({ id: tx.id, field });
  };

  const commitEdit = (tx: PlannedTransaction) => {
    if (!editForm) return;
    const amount = parseFloat(editForm.amount);
    if (isNaN(amount)) {
      // Revert invalid amount and close without saving
      setEditForm({ ...editForm, amount: String(Math.abs(tx.amount)) });
      setActiveCell(null);
      return;
    }
    updateTx.mutate({
      id: tx.id,
      goalId: editForm.goalId,
      transactionDate: editForm.transactionDate,
      description: editForm.description,
      amount: String(tx.amount < 0 ? -Math.abs(amount) : Math.abs(amount)),
      isRecurring: editForm.isRecurring,
      recurrenceMonths: editForm.isRecurring ? editForm.recurrenceMonths : null,
    });
  };

  // The goals the forms point at, checked against the current goal list —
  // the forms are seeded once, and a goal can be removed or hidden (or the
  // list arrive) while one is open. Display and submit use the same value.
  const goalIds = new Set(goalProjections.map((gp) => gp.goalId));
  const addGoalId = goalIds.has(addForm.goalId)
    ? addForm.goalId
    : (goalProjections[0]?.goalId ?? 0);
  const fromGoalId = goalIds.has(transferForm.fromGoalId)
    ? transferForm.fromGoalId
    : 0;
  const toGoalId =
    goalIds.has(transferForm.toGoalId) && transferForm.toGoalId !== fromGoalId
      ? transferForm.toGoalId
      : 0;

  const commitAdd = () => {
    const amount = parseFloat(addForm.amount);
    if (
      !addGoalId ||
      !addForm.description ||
      !addForm.transactionDate ||
      isNaN(amount)
    )
      return;
    createTx.mutate({
      goalId: addGoalId,
      transactionDate: addForm.transactionDate,
      description: addForm.description,
      amount: String(addForm.isNegative ? -Math.abs(amount) : Math.abs(amount)),
      isRecurring: addForm.isRecurring,
      recurrenceMonths: addForm.isRecurring ? addForm.recurrenceMonths : null,
    });
  };

  const commitTransfer = () => {
    const amount = parseFloat(transferForm.amount);
    if (
      !fromGoalId ||
      !toGoalId ||
      !transferForm.transactionDate ||
      !transferForm.description ||
      isNaN(amount) ||
      amount <= 0
    )
      return;
    createTransfer.mutate({
      fromGoalId,
      toGoalId,
      transactionDate: transferForm.transactionDate,
      amount: amount,
      description: transferForm.description,
      isRecurring: transferForm.isRecurring,
      recurrenceMonths: transferForm.isRecurring
        ? transferForm.recurrenceMonths
        : null,
    });
  };

  const cancelAdd = () => {
    setAdding(false);
    setAddMode("transaction");
  };

  const toGoalOptions = goalProjections.filter(
    (gp) => gp.goalId !== fromGoalId,
  );

  const isCellActive = (txId: number, field: ActiveCellField) =>
    activeCell?.id === txId && activeCell.field === field;

  // Shared blur/keydown handlers for inline inputs
  const makeInputHandlers = (tx: PlannedTransaction) => ({
    onBlur: () => {
      if (committed.current === activeCell) return;
      commitEdit(tx);
      setActiveCell(null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        committed.current = activeCell;
        commitEdit(tx);
        setActiveCell(null);
      }
      if (e.key === "Escape") {
        setEditingId(null);
        setEditForm(null);
        setActiveCell(null);
      }
    },
  });

  return (
    <div className="space-y-3">
      {/* Add form */}
      {canEdit !== false && adding && (
        <div className="bg-surface-elevated space-y-3 rounded-lg border p-3">
          {/* Mode toggle */}
          <SegmentedControl
            look="tray-sunken"
            ariaLabel="New entry type"
            value={addMode}
            onChange={setAddMode}
            options={ADD_MODES}
          />

          {addMode === "transaction" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <TransactionAmountFields
                  addGoalId={addGoalId}
                  setAddForm={setAddForm}
                  addForm={addForm}
                  goalProjections={goalProjections}
                />

                <TransactionDetailFields
                  addForm={addForm}
                  setAddForm={setAddForm}
                  commitAdd={commitAdd}
                  cancelAdd={cancelAdd}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={commitAdd}
                  disabled={createTx.isPending}
                >
                  {createTx.isPending ? "Adding…" : "Add"}
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelAdd}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <TransferRouteFields
                  fromGoalId={fromGoalId}
                  setTransferForm={setTransferForm}
                  transferForm={transferForm}
                  goalProjections={goalProjections}
                  toGoalId={toGoalId}
                  toGoalOptions={toGoalOptions}
                />

                <TransferDetailFields
                  transferForm={transferForm}
                  setTransferForm={setTransferForm}
                  commitTransfer={commitTransfer}
                  cancelAdd={cancelAdd}
                />
              </div>

              {transferForm.fromGoalId > 0 &&
                transferForm.toGoalId > 0 &&
                Number(transferForm.amount) > 0 && (
                  <p className="text-caption text-faint">
                    {formatCurrency(Number(transferForm.amount))} from{" "}
                    <span className="text-red-500">
                      {fundNameMap.get(transferForm.fromGoalId)}
                    </span>{" "}
                    →{" "}
                    <span className="text-green-600">
                      {fundNameMap.get(transferForm.toGoalId)}
                    </span>
                  </p>
                )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={commitTransfer}
                  disabled={createTransfer.isPending}
                >
                  {createTransfer.isPending ? "Adding…" : "Add Transfer"}
                </Button>
                <Button variant="ghost" size="sm" onClick={cancelAdd}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Settlement hints, never auto-applied: a real transaction in the linked category on/after
          the planned date is already in the live balance. Dismissing hides it for this session. */}
      <SettlementSuggestions
        canEdit={canEdit}
        suggestions={suggestions}
        settleMany={settleMany}
        setDismissedSuggestions={setDismissedSuggestions}
        plannedTxById={plannedTxById}
        fundNameMap={fundNameMap}
        settleTx={settleTx}
      />
      <TransactionsToolbar
        canEdit={canEdit}
        adding={adding}
        setAdding={setAdding}
        plannedTransactions={plannedTransactions}
        setShowRuleTx={setShowRuleTx}
        showRuleTx={showRuleTx}
        historyWindow={historyWindow}
        setHistoryWindow={setHistoryWindow}
        tableLocked={tableLocked}
        setTableLocked={setTableLocked}
      />
      {/* Transaction table */}
      {past.length === 0 && upcoming.length === 0 ? (
        <p className="text-faint py-8 text-center text-sm">
          No transactions across any fund.
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full border-collapse text-xs">
            <TransactionsTableHead canEdit={canEdit} />
            <tbody>
              {/* Past (history) rows */}
              {past.map((tx) => {
                const isTransfer = !!tx.transferPairId;
                const color = fundColorMap.get(tx.goalId);
                const name = fundNameMap.get(tx.goalId) ?? "Unknown";
                const otherLeg = isTransfer
                  ? plannedTransactions.find(
                      (t) =>
                        t.transferPairId === tx.transferPairId &&
                        t.id !== tx.id,
                    )
                  : null;
                const fromLeg = isTransfer
                  ? tx.amount < 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;
                const toLeg = isTransfer
                  ? tx.amount > 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;
                return (
                  <tr
                    key={`hist-${tx.id}`}
                    className="bg-surface-elevated/20 border-b"
                  >
                    <HistoryRowCells
                      isTransfer={isTransfer}
                      fundColorMap={fundColorMap}
                      fromLeg={fromLeg}
                      fundNameMap={fundNameMap}
                      toLeg={toLeg}
                      color={color}
                      name={name}
                      tx={tx}
                      canEdit={canEdit}
                      settledOccurrences={settledOccurrences}
                      monthsAgo={monthsAgo}
                      AGE_NUDGE_MONTHS={AGE_NUDGE_MONTHS}
                      settleTx={settleTx}
                    />
                  </tr>
                );
              })}

              {/* Separator between history and upcoming */}
              {past.length > 0 && upcoming.length > 0 && (
                <tr aria-hidden="true">
                  <td
                    colSpan={canEdit !== false ? 7 : 6}
                    className="text-caption text-faint/50 bg-surface-sunken border-t border-b px-3 py-1 text-center tracking-widest"
                  >
                    ─── Upcoming ───
                  </td>
                </tr>
              )}

              {upcoming.map((tx) => {
                const isTransfer = !!tx.transferPairId;
                const color = fundColorMap.get(tx.goalId);
                const name = fundNameMap.get(tx.goalId) ?? "Unknown";

                const otherLeg = isTransfer
                  ? plannedTransactions.find(
                      (t) =>
                        t.transferPairId === tx.transferPairId &&
                        t.id !== tx.id,
                    )
                  : null;
                const fromLeg = isTransfer
                  ? tx.amount < 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;
                const toLeg = isTransfer
                  ? tx.amount > 0
                    ? tx
                    : (otherLeg ?? tx)
                  : null;

                const isRuleRow = tx.source === "rule";
                const editable =
                  !tableLocked &&
                  !isTransfer &&
                  !isRuleRow &&
                  canEdit !== false;
                const handlers = makeInputHandlers(tx);
                const edit = (field: ActiveCellField) =>
                  editable ? () => activateCell(tx, field) : undefined;

                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-surface-elevated/40 border-b transition-colors last:border-0"
                  >
                    <UpcomingFundCell
                      editable={editable}
                      edit={edit}
                      isCellActive={isCellActive}
                      tx={tx}
                      editForm={editForm}
                      fundColorMap={fundColorMap}
                      setEditForm={setEditForm}
                      handlers={handlers}
                      goalProjections={goalProjections}
                      isTransfer={isTransfer}
                      fundNameMap={fundNameMap}
                      fromLeg={fromLeg}
                      toLeg={toLeg}
                      color={color}
                      name={name}
                    />

                    <UpcomingDateAndDescriptionCells
                      editable={editable}
                      edit={edit}
                      isCellActive={isCellActive}
                      tx={tx}
                      editForm={editForm}
                      setEditForm={setEditForm}
                      handlers={handlers}
                      isTransfer={isTransfer}
                      isRuleRow={isRuleRow}
                    />

                    <UpcomingAmountCells
                      editable={editable}
                      isTransfer={isTransfer}
                      tx={tx}
                      edit={edit}
                      isCellActive={isCellActive}
                      editForm={editForm}
                      setEditForm={setEditForm}
                      handlers={handlers}
                      getBalanceAfter={getBalanceAfter}
                    />

                    <UpcomingActionsCell
                      canEdit={canEdit}
                      tx={tx}
                      settledOccurrences={settledOccurrences}
                      settleTx={settleTx}
                      tableLocked={tableLocked}
                      isRuleRow={isRuleRow}
                      isTransfer={isTransfer}
                      deleteTransfer={deleteTransfer}
                      deleteTx={deleteTx}
                    />
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
