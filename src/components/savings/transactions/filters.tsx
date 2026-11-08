import type { Dispatch, SetStateAction } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditLockToggle } from "@/components/ui/edit-lock-toggle";
import type { PlannedTransaction } from "@/lib/pure/savings/savings-projection";

export function TransactionsToolbar({
  canEdit,
  adding,
  setAdding,
  plannedTransactions,
  setShowRuleTx,
  showRuleTx,
  historyWindow,
  setHistoryWindow,
  tableLocked,
  setTableLocked,
}: {
  canEdit: boolean | undefined;
  adding: boolean;
  setAdding: Dispatch<SetStateAction<boolean>>;
  plannedTransactions: PlannedTransaction[];
  setShowRuleTx: (v: boolean) => void;
  showRuleTx: boolean;
  historyWindow: 0 | 3 | 6 | 12 | "all";
  setHistoryWindow: (v: 0 | 3 | 6 | 12 | "all") => void;
  tableLocked: boolean;
  setTableLocked: (v: boolean) => void;
}) {
  return (
    <>
      {/* Toolbar: add button + history selector + lock */}
      <div className="text-label text-faint flex items-center justify-between gap-4 px-1">
        <div className="flex items-center gap-2">
          {canEdit !== false && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="text-label bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong rounded border px-2.5 py-1"
            >
              + Add transaction
            </button>
          )}
          {plannedTransactions.some((tx) => tx.source === "rule") && (
            <button
              onClick={() => setShowRuleTx(!showRuleTx)}
              className={`text-label rounded border px-2 py-0.5 transition-colors ${
                showRuleTx
                  ? "border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950/20"
                  : "border-surface-strong text-faint hover:text-primary"
              }`}
              title={
                showRuleTx
                  ? "Hide extra paycheck transactions"
                  : "Show extra paycheck transactions"
              }
            >
              {showRuleTx ? "Hide" : "Show"} extra paychecks
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(historyWindow)}
            onChange={(e) => {
              const v = e.target.value;
              setHistoryWindow(
                v === "all" ? "all" : (Number(v) as 0 | 3 | 6 | 12),
              );
            }}
            aria-label="History window"
            className="text-label border-surface-strong bg-surface-primary text-faint hover:text-primary rounded border px-1.5 py-0.5"
          >
            <option value="0">No history</option>
            <option value="3">3 months history</option>
            <option value="6">6 months history</option>
            <option value="12">1 year history</option>
            <option value="all">All history</option>
          </select>
          <EditLockToggle
            locked={tableLocked}
            onToggle={() => setTableLocked(!tableLocked)}
            disabled={canEdit === false}
          />
        </div>
      </div>
    </>
  );
}

export function SettlementSuggestions({
  canEdit,
  suggestions,
  settleMany,
  setDismissedSuggestions,
  plannedTxById,
  fundNameMap,
  settleTx,
}: {
  canEdit: boolean | undefined;
  suggestions: { plannedTxId: number; occurrenceMonth: string }[];
  settleMany: {
    mutate: (input: {
      occurrences: { plannedTxId: number; occurrenceMonth: string }[];
    }) => void;
    isPending: boolean;
  };
  setDismissedSuggestions: Dispatch<SetStateAction<Set<string>>>;
  plannedTxById: Map<number, PlannedTransaction>;
  fundNameMap: Map<number, string>;
  settleTx: {
    mutate: (input: { plannedTxId: number; occurrenceMonth: string }) => void;
    isPending: boolean;
  };
}) {
  return (
    <>
      {canEdit !== false && suggestions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              <CheckCircle2 className="-mt-0.5 mr-1 inline-block h-3.5 w-3.5" />
              {suggestions.length} planned transaction
              {suggestions.length === 1 ? "" : "s"} look{" "}
              {suggestions.length === 1 ? "s" : ""} settled — real activity was
              found in the linked category.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={settleMany.isPending}
                onClick={() =>
                  settleMany.mutate({
                    occurrences: suggestions.map((s) => ({
                      plannedTxId: s.plannedTxId,
                      occurrenceMonth: s.occurrenceMonth,
                    })),
                  })
                }
              >
                {settleMany.isPending ? "Settling…" : "Settle all"}
              </Button>
              <button
                onClick={() =>
                  setDismissedSuggestions(
                    (prev) =>
                      new Set([
                        ...prev,
                        ...suggestions.map(
                          (s) => `${s.plannedTxId}:${s.occurrenceMonth}`,
                        ),
                      ]),
                  )
                }
                className="text-faint hover:text-primary text-xs"
              >
                Dismiss
              </button>
            </div>
          </div>
          <ul className="space-y-1">
            {suggestions.map((s) => {
              const tx = plannedTxById.get(s.plannedTxId);
              if (!tx) return null;
              const key = `${s.plannedTxId}:${s.occurrenceMonth}`;
              return (
                <li
                  key={key}
                  className="bg-surface-primary/50 flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-blue-800 dark:text-blue-200"
                >
                  <span>
                    {fundNameMap.get(tx.goalId) ?? "Unknown"} — {tx.description}{" "}
                    ({s.occurrenceMonth})
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() =>
                        settleTx.mutate({
                          plannedTxId: s.plannedTxId,
                          occurrenceMonth: s.occurrenceMonth,
                        })
                      }
                      disabled={settleTx.isPending}
                      className="font-medium text-blue-600 hover:text-blue-800"
                    >
                      Settle
                    </button>
                    <button
                      onClick={() =>
                        setDismissedSuggestions(
                          (prev) => new Set([...prev, key]),
                        )
                      }
                      className="text-faint hover:text-primary"
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
