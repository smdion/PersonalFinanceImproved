import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { confirm } from "@/components/ui/confirm-dialog";
import type { NewFundForm, RawGoal } from "./types";

export function AddSubGoal({
  addingSubGoalForFund,
  rawGoal,
  newFund,
  setNewFund,
  onCreateFund,
  setAddingSubGoalForFund,
  createGoalPending,
}: {
  addingSubGoalForFund: number | null;
  rawGoal: RawGoal;
  newFund: NewFundForm;
  setNewFund: (form: NewFundForm) => void;
  onCreateFund: () => void;
  setAddingSubGoalForFund: (id: number | null) => void;
  createGoalPending: boolean;
}) {
  return (
    <>
      {addingSubGoalForFund === rawGoal.id ? (
        <div className="mt-1 flex items-center gap-2">
          <input
            aria-label="Goal name"
            type="text"
            value={newFund.name}
            onChange={(e) =>
              setNewFund({
                ...newFund,
                name: e.target.value,
                parentGoalId: rawGoal.id,
              })
            }
            placeholder="Goal name..."
            className="border-default bg-surface-primary text-primary w-full flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateFund();
              if (e.key === "Escape") setAddingSubGoalForFund(null);
            }}
          />
          <input
            aria-label="Target $"
            type="number"
            value={newFund.targetAmount}
            onChange={(e) =>
              setNewFund({
                ...newFund,
                targetAmount: e.target.value,
                parentGoalId: rawGoal.id,
              })
            }
            placeholder="Target $"
            className="border-default bg-surface-primary text-primary w-24 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateFund}
            disabled={!newFund.name || createGoalPending}
          >
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAddingSubGoalForFund(null);
              setNewFund({
                name: "",
                targetAmount: "",
                targetMode: "fixed",
                targetDate: "",
                parentGoalId: null,
              });
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button
          onClick={() => {
            setAddingSubGoalForFund(rawGoal.id);
            setNewFund({
              name: "",
              targetAmount: "",
              targetMode: "fixed",
              targetDate: "",
              parentGoalId: rawGoal.id,
            });
          }}
          className="text-xs text-blue-600 transition-colors hover:text-blue-700"
        >
          + Add goal
        </button>
      )}
    </>
  );
}

export function SubGoalProgressAndMove({
  childProgress,
  reassigningChildId,
  child,
  onUpdateParent,
  availableParents,
  setReassigningChildId,
  rawGoal,
}: {
  childProgress: number;
  reassigningChildId: number | null;
  child: RawGoal;
  onUpdateParent:
    ((childGoalId: number, newParentId: number | null) => void) | undefined;
  availableParents: { id: number; name: string }[] | undefined;
  setReassigningChildId: Dispatch<SetStateAction<number | null>>;
  rawGoal: RawGoal;
}) {
  return (
    <>
      <div className="bg-surface-strong mt-0.5 h-1.5 w-full rounded-full">
        <div
          className={`h-1.5 rounded-full ${childProgress >= 1 ? "bg-green-500" : "bg-indigo-400"}`}
          style={{ width: `${childProgress * 100}%` }}
        />
      </div>
      {reassigningChildId === child.id &&
        onUpdateParent &&
        availableParents && (
          <div className="mt-1 flex items-center gap-1">
            <select
              aria-label="Move to"
              className="border-default bg-surface-primary text-primary flex-1 rounded border px-1.5 py-0.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              defaultValue=""
              onChange={(e) => {
                const val = e.target.value;
                onUpdateParent(child.id, val === "" ? null : Number(val));
                setReassigningChildId(null);
              }}
            >
              <option value="" disabled>
                Move to...
              </option>
              <option value="">None (top-level)</option>
              {availableParents
                .filter((p) => p.id !== rawGoal.id && p.id !== child.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <button
              onClick={() => setReassigningChildId(null)}
              className="text-xs text-blue-600 transition-colors hover:text-blue-700"
            >
              Cancel
            </button>
          </div>
        )}
    </>
  );
}

export function SubGoalActions({
  canEdit,
  onUpdateParent,
  availableParents,
  setReassigningChildId,
  reassigningChildId,
  child,
  onDeleteGoal,
}: {
  canEdit: boolean | undefined;
  onUpdateParent:
    ((childGoalId: number, newParentId: number | null) => void) | undefined;
  availableParents: { id: number; name: string }[] | undefined;
  setReassigningChildId: Dispatch<SetStateAction<number | null>>;
  reassigningChildId: number | null;
  child: RawGoal;
  onDeleteGoal: (params: { id: number }) => void;
}) {
  return (
    <>
      {canEdit !== false && onUpdateParent && availableParents && (
        <button
          onClick={() =>
            setReassigningChildId(
              reassigningChildId === child.id ? null : child.id,
            )
          }
          className="text-xs text-blue-600 transition-colors hover:text-blue-700"
          title="Move to another fund"
        >
          &#8596;
        </button>
      )}
      {canEdit !== false && (
        <button
          onClick={async () => {
            if (await confirm(`Delete "${child.name}"?`))
              onDeleteGoal({ id: child.id });
          }}
          className="text-faint text-xs transition-colors hover:text-red-600"
          title="Delete goal"
        >
          &times;
        </button>
      )}
    </>
  );
}
