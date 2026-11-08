/** The All Transactions table's row cells. */
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { CheckCircle2 } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
import { CellButton } from "@/components/ui/cell-button";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import {
  occurrenceKey,
  type PlannedTransaction,
} from "@/lib/pure/savings/savings-projection";
import type { GoalProjection } from "../types";

export interface EditForm {
  goalId: number;
  transactionDate: string;
  description: string;
  amount: string;
  isRecurring: boolean;
  recurrenceMonths: number;
}

export function balanceAfterCell(
  isTransfer: boolean,
  getBalanceAfter: (goalId: number, dateStr: string) => number | undefined,
  tx: PlannedTransaction,
) {
  // Transfer rows are collapsed to a single leg (deduped by
  // transferPairId), so a per-fund balance here would reflect
  // only whichever leg survived. Suppress it to avoid showing
  // an ambiguous balance for a two-fund movement.
  if (isTransfer)
    return (
      <td className="text-faint/40 px-3 py-2 text-right text-xs tabular-nums">
        —
      </td>
    );
  const bal = getBalanceAfter(tx.goalId, tx.transactionDate);
  if (bal === undefined)
    return (
      <td className="text-faint/40 px-3 py-2 text-right text-xs tabular-nums">
        —
      </td>
    );
  return (
    <td
      className={`px-3 py-2 text-right text-xs font-medium whitespace-nowrap tabular-nums ${
        bal < 0 ? "text-red-500" : "text-muted"
      }`}
    >
      {formatCurrency(bal)}
    </td>
  );
}

export function UpcomingActionsCell({
  canEdit,
  tx,
  settledOccurrences,
  settleTx,
  tableLocked,
  isRuleRow,
  isTransfer,
  deleteTransfer,
  deleteTx,
}: {
  canEdit: boolean | undefined;
  tx: PlannedTransaction;
  settledOccurrences: Set<string>;
  settleTx: {
    mutate: (input: { plannedTxId: number; occurrenceMonth: string }) => void;
    isPending: boolean;
  };
  tableLocked: boolean;
  isRuleRow: boolean;
  isTransfer: boolean;
  deleteTransfer: {
    mutate: (input: { transferPairId: string }) => void;
    isPending: boolean;
  };
  deleteTx: { mutate: (input: { id: number }) => void; isPending: boolean };
}) {
  return (
    <>
      {/* Actions */}
      {canEdit !== false && (
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            {!tx.isRecurring &&
              (settledOccurrences.has(
                occurrenceKey(tx.id, tx.transactionDate.slice(0, 7)),
              ) ? (
                <span
                  title="Settled — excluded from projections"
                  className="text-green-600"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </span>
              ) : (
                <button
                  onClick={() =>
                    settleTx.mutate({
                      plannedTxId: tx.id,
                      occurrenceMonth: tx.transactionDate.slice(0, 7),
                    })
                  }
                  disabled={settleTx.isPending}
                  title="Mark settled — this happened, exclude it from future projections"
                  className="text-faint text-xs transition-colors hover:text-green-600 disabled:opacity-50"
                >
                  Settle
                </button>
              ))}
            {!tableLocked && !isRuleRow && (
              <button
                onClick={() =>
                  isTransfer && tx.transferPairId
                    ? deleteTransfer.mutate({
                        transferPairId: tx.transferPairId,
                      })
                    : deleteTx.mutate({ id: tx.id })
                }
                disabled={deleteTx.isPending || deleteTransfer.isPending}
                className="text-faint text-xs transition-colors hover:text-red-600 disabled:opacity-50"
              >
                ×
              </button>
            )}
          </div>
        </td>
      )}
    </>
  );
}

export function UpcomingAmountCells({
  editable,
  isTransfer,
  tx,
  edit,
  isCellActive,
  editForm,
  setEditForm,
  handlers,
  getBalanceAfter,
}: {
  editable: boolean;
  isTransfer: boolean;
  tx: PlannedTransaction;
  edit: (field: "amount") => (() => void) | undefined;
  isCellActive: (txId: number, field: "amount") => boolean;
  editForm: EditForm | null;
  setEditForm: Dispatch<SetStateAction<EditForm | null>>;
  handlers: { onBlur: () => void; onKeyDown: (e: KeyboardEvent) => void };
  getBalanceAfter: (goalId: number, dateStr: string) => number | undefined;
}) {
  return (
    <>
      {/* Amount */}
      <td
        className={`px-3 py-2 text-right font-medium tabular-nums whitespace-nowrap${editable ? "cursor-pointer" : ""} ${
          isTransfer
            ? "text-blue-500"
            : tx.amount < 0
              ? "text-red-500"
              : "text-green-600"
        }`}
        onClick={edit("amount")}
      >
        {isCellActive(tx.id, "amount") && editForm ? (
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={editForm.amount}
            onChange={(e) =>
              setEditForm({ ...editForm, amount: e.target.value })
            }
            onBlur={handlers.onBlur}
            onKeyDown={handlers.onKeyDown}
            className="border-default bg-surface-primary text-primary w-24 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        ) : isTransfer ? (
          formatCurrency(Math.abs(tx.amount))
        ) : (
          <CellButton enabled={editable}>
            {`${tx.amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(tx.amount))}`}
          </CellButton>
        )}
      </td>

      {/* Balance after — end-of-month projected balance for this fund */}
      {balanceAfterCell(isTransfer, getBalanceAfter, tx)}

      {/* Recurring */}
      <td className="text-faint px-3 py-2 text-center">
        {tx.isRecurring ? (
          <span className="text-caption">every {tx.recurrenceMonths}mo</span>
        ) : (
          <span className="text-caption text-faint/40">—</span>
        )}
      </td>
    </>
  );
}

export function UpcomingDateAndDescriptionCells({
  editable,
  edit,
  isCellActive,
  tx,
  editForm,
  setEditForm,
  handlers,
  isTransfer,
  isRuleRow,
}: {
  editable: boolean;
  edit: (field: "transactionDate" | "description") => (() => void) | undefined;
  isCellActive: (
    txId: number,
    field: "transactionDate" | "description",
  ) => boolean;
  tx: PlannedTransaction;
  editForm: EditForm | null;
  setEditForm: Dispatch<SetStateAction<EditForm | null>>;
  handlers: { onBlur: () => void; onKeyDown: (e: KeyboardEvent) => void };
  isTransfer: boolean;
  isRuleRow: boolean;
}) {
  return (
    <>
      {/* Date */}
      <td
        className={`text-muted px-3 py-2 whitespace-nowrap tabular-nums${editable ? "cursor-pointer" : ""}`}
        onClick={edit("transactionDate")}
      >
        {isCellActive(tx.id, "transactionDate") && editForm ? (
          <input
            autoFocus
            type="date"
            value={editForm.transactionDate}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                transactionDate: e.target.value,
              })
            }
            onBlur={handlers.onBlur}
            onKeyDown={handlers.onKeyDown}
            className="border-default bg-surface-primary text-primary rounded border px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        ) : (
          <CellButton enabled={editable}>
            {formatDate(new Date(tx.transactionDate + "T00:00:00"), "short")}
          </CellButton>
        )}
      </td>

      {/* Description */}
      <td
        className={`px-3 py-2 text-muted${editable ? "cursor-pointer" : ""}`}
        onClick={edit("description")}
      >
        {isCellActive(tx.id, "description") && editForm ? (
          <input
            autoFocus
            type="text"
            value={editForm.description}
            onChange={(e) =>
              setEditForm({
                ...editForm,
                description: e.target.value,
              })
            }
            onBlur={handlers.onBlur}
            onKeyDown={handlers.onKeyDown}
            className="border-default bg-surface-primary text-primary w-full rounded border px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        ) : (
          <CellButton enabled={editable}>
            {isTransfer && (
              <Badge color="blue" case="normal" className="mr-1.5">
                transfer
              </Badge>
            )}
            {isRuleRow && (
              <Badge color="purple" case="normal" className="mr-1.5">
                extra paycheck
              </Badge>
            )}
            {tx.description}
          </CellButton>
        )}
      </td>
    </>
  );
}

export function UpcomingFundCell({
  editable,
  edit,
  isCellActive,
  tx,
  editForm,
  fundColorMap,
  setEditForm,
  handlers,
  goalProjections,
  isTransfer,
  fundNameMap,
  fromLeg,
  toLeg,
  color,
  name,
}: {
  editable: boolean;
  edit: (field: "goalId") => (() => void) | undefined;
  isCellActive: (txId: number, field: "goalId") => boolean;
  tx: PlannedTransaction;
  editForm: EditForm | null;
  fundColorMap: Map<number, string | undefined>;
  setEditForm: Dispatch<SetStateAction<EditForm | null>>;
  handlers: { onBlur: () => void; onKeyDown: (e: KeyboardEvent) => void };
  goalProjections: GoalProjection[];
  isTransfer: boolean;
  fundNameMap: Map<number, string>;
  fromLeg: PlannedTransaction | null;
  toLeg: PlannedTransaction | null;
  color: string | undefined;
  name: string;
}) {
  return (
    <>
      {/* Fund */}
      <td
        className={`px-3 py-2 whitespace-nowrap${editable ? "cursor-pointer" : ""}`}
        onClick={edit("goalId")}
      >
        {isCellActive(tx.id, "goalId") && editForm ? (
          <div className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: fundColorMap.get(editForm.goalId),
              }}
            />
            <select
              autoFocus
              value={editForm.goalId}
              onChange={(e) =>
                setEditForm({
                  ...editForm,
                  goalId: Number(e.target.value),
                })
              }
              onBlur={handlers.onBlur}
              onKeyDown={handlers.onKeyDown}
              className="border-default bg-surface-primary text-primary rounded border px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            >
              {goalProjections.map((gp) => (
                <option key={gp.goalId} value={gp.goalId}>
                  {gp.name}
                </option>
              ))}
            </select>
          </div>
        ) : isTransfer ? (
          <span className="text-caption inline-flex items-center gap-1">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: fundColorMap.get(fromLeg?.goalId ?? 0),
              }}
            />
            <span className="text-muted">
              {fundNameMap.get(fromLeg?.goalId ?? 0) ?? "?"}
            </span>
            <span className="text-faint">→</span>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: fundColorMap.get(toLeg?.goalId ?? 0),
              }}
            />
            <span className="text-muted">
              {fundNameMap.get(toLeg?.goalId ?? 0) ?? "?"}
            </span>
          </span>
        ) : (
          <CellButton enabled={editable}>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-secondary font-medium">{name}</span>
            </span>
          </CellButton>
        )}
      </td>
    </>
  );
}

export function HistoryRowCells({
  isTransfer,
  fundColorMap,
  fromLeg,
  fundNameMap,
  toLeg,
  color,
  name,
  tx,
  canEdit,
  settledOccurrences,
  monthsAgo,
  AGE_NUDGE_MONTHS,
  settleTx,
}: {
  isTransfer: boolean;
  fundColorMap: Map<number, string | undefined>;
  fromLeg: PlannedTransaction | null;
  fundNameMap: Map<number, string>;
  toLeg: PlannedTransaction | null;
  color: string | undefined;
  name: string;
  tx: PlannedTransaction;
  canEdit: boolean | undefined;
  settledOccurrences: Set<string>;
  monthsAgo: (dateStr: string) => number;
  AGE_NUDGE_MONTHS: number;
  settleTx: {
    mutate: (input: { plannedTxId: number; occurrenceMonth: string }) => void;
    isPending: boolean;
  };
}) {
  return (
    <>
      <td className="px-3 py-2 whitespace-nowrap">
        {isTransfer ? (
          <span className="text-caption inline-flex items-center gap-1">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: fundColorMap.get(fromLeg?.goalId ?? 0),
              }}
            />
            <span className="text-faint">
              {fundNameMap.get(fromLeg?.goalId ?? 0) ?? "?"}
            </span>
            <span className="text-faint/50">→</span>
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: fundColorMap.get(toLeg?.goalId ?? 0),
              }}
            />
            <span className="text-faint">
              {fundNameMap.get(toLeg?.goalId ?? 0) ?? "?"}
            </span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-faint font-medium">{name}</span>
          </span>
        )}
      </td>
      <td className="text-faint px-3 py-2 whitespace-nowrap tabular-nums">
        {formatDate(new Date(tx.transactionDate + "T00:00:00"), "short")}
      </td>
      <td className="text-faint px-3 py-2">
        {isTransfer && (
          <Badge color="blue" case="normal" className="mr-1.5">
            transfer
          </Badge>
        )}
        {tx.description}
      </td>
      <td
        className={`px-3 py-2 text-right font-medium whitespace-nowrap tabular-nums ${
          isTransfer
            ? "text-blue-400/70"
            : tx.amount < 0
              ? "text-red-400/70"
              : "text-green-500/70"
        }`}
      >
        {isTransfer
          ? formatCurrency(Math.abs(tx.amount))
          : `${tx.amount < 0 ? "−" : "+"}${formatCurrency(Math.abs(tx.amount))}`}
      </td>
      <td className="text-faint/40 px-3 py-2 text-right tabular-nums">
        <span className="text-caption">—</span>
      </td>
      <td className="text-faint/40 px-3 py-2 text-center">
        <span className="text-caption">—</span>
      </td>
      {canEdit !== false && (
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {!isTransfer &&
            (settledOccurrences.has(
              occurrenceKey(tx.id, tx.transactionDate.slice(0, 7)),
            ) ? (
              <span
                title="Settled — excluded from projections"
                className="inline-block text-green-600"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                {monthsAgo(tx.transactionDate) >= AGE_NUDGE_MONTHS && (
                  <span
                    title="No matching real activity was found — settle it if it happened, or delete it if it didn't"
                    className="text-caption text-amber-600"
                  >
                    {monthsAgo(tx.transactionDate)}mo ago — still open?
                  </span>
                )}
                <button
                  onClick={() =>
                    settleTx.mutate({
                      plannedTxId: tx.id,
                      occurrenceMonth: tx.transactionDate.slice(0, 7),
                    })
                  }
                  disabled={settleTx.isPending}
                  title="Mark settled — this happened, exclude it from future projections"
                  className="text-faint text-xs transition-colors hover:text-green-600 disabled:opacity-50"
                >
                  Settle
                </button>
              </span>
            ))}
        </td>
      )}
    </>
  );
}

export function TransactionsTableHead({
  canEdit,
}: {
  canEdit: boolean | undefined;
}) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="bg-surface-sunken border-b">
        <th className="text-muted px-3 py-2 text-left font-medium whitespace-nowrap">
          Fund
        </th>
        <th className="text-muted px-3 py-2 text-left font-medium whitespace-nowrap">
          Date
        </th>
        <th className="text-muted px-3 py-2 text-left font-medium">
          Description
        </th>
        <th className="text-muted px-3 py-2 text-right font-medium whitespace-nowrap">
          Amount
        </th>
        <th
          className="text-muted px-3 py-2 text-right font-medium whitespace-nowrap"
          title="Projected end-of-month balance for this fund — includes contributions, recurring expenses, and month changes (matches the Plan table)"
        >
          After
        </th>
        <th className="text-muted px-3 py-2 text-center font-medium whitespace-nowrap">
          Recurring
        </th>
        {canEdit !== false && (
          <th className="text-muted px-3 py-2 text-right font-medium whitespace-nowrap">
            <span className="inline-flex items-center">
              Settled
              <HelpTip
                lines={[
                  "Once a planned deposit or withdrawal has actually happened, settle it instead of deleting it.",
                  "Settling excludes it from future balance projections — your synced balance already reflects the real activity — while keeping the row for your records.",
                  "Never automatic: for budget-linked funds a banner may suggest likely-settled items based on real account activity, but nothing settles without a click.",
                ]}
                maxWidth={260}
              />
            </span>
          </th>
        )}
      </tr>
    </thead>
  );
}
