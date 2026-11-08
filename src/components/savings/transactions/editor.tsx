/** The All Transactions tab's add form fields. */
import type { Dispatch, SetStateAction } from "react";
import type { GoalProjection } from "../types";

export const defaultAddForm = {
  goalId: 0,
  transactionDate: "",
  description: "",
  amount: "",
  isNegative: true,
  isRecurring: false,
  recurrenceMonths: 1,
};

export const defaultTransferForm = {
  fromGoalId: 0,
  toGoalId: 0,
  transactionDate: "",
  amount: "",
  description: "",
  isRecurring: false,
  recurrenceMonths: 1,
};

export function TransferDetailFields({
  transferForm,
  setTransferForm,
  commitTransfer,
  cancelAdd,
}: {
  transferForm: typeof defaultTransferForm;
  setTransferForm: Dispatch<SetStateAction<typeof defaultTransferForm>>;
  commitTransfer: () => void;
  cancelAdd: () => void;
}) {
  return (
    <>
      {/* Date */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">Date</label>
        <input
          type="date"
          value={transferForm.transactionDate}
          onChange={(e) =>
            setTransferForm({
              ...transferForm,
              transactionDate: e.target.value,
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Description */}
      <div className="col-span-2">
        <label className="text-caption text-faint mb-0.5 block">
          Description
        </label>
        <input
          type="text"
          placeholder="e.g. Move travel funds to home projects"
          value={transferForm.description}
          onChange={(e) =>
            setTransferForm({
              ...transferForm,
              description: e.target.value,
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") commitTransfer();
            if (e.key === "Escape") cancelAdd();
          }}
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Recurring */}
      <div className="col-span-2 flex items-center gap-3 sm:col-span-3">
        <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={transferForm.isRecurring}
            onChange={(e) =>
              setTransferForm({
                ...transferForm,
                isRecurring: e.target.checked,
              })
            }
          />
          Recurring
        </label>
        {transferForm.isRecurring && (
          <div className="text-muted flex items-center gap-1 text-xs">
            <span>every</span>
            <input
              type="number"
              min={1}
              value={transferForm.recurrenceMonths}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                setTransferForm({
                  ...transferForm,
                  recurrenceMonths:
                    Number.isFinite(parsed) && parsed >= 1
                      ? Math.floor(parsed)
                      : 1,
                });
              }}
              className="border-default bg-surface-primary text-primary w-12 rounded border px-1.5 py-0.5 text-center text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <span>months</span>
          </div>
        )}
      </div>
    </>
  );
}

export function TransferRouteFields({
  fromGoalId,
  setTransferForm,
  transferForm,
  goalProjections,
  toGoalId,
  toGoalOptions,
}: {
  fromGoalId: number;
  setTransferForm: Dispatch<SetStateAction<typeof defaultTransferForm>>;
  transferForm: typeof defaultTransferForm;
  goalProjections: GoalProjection[];
  toGoalId: number;
  toGoalOptions: GoalProjection[];
}) {
  return (
    <>
      {/* From */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">From</label>
        <select
          value={fromGoalId}
          onChange={(e) =>
            setTransferForm({
              ...transferForm,
              fromGoalId: Number(e.target.value),
              toGoalId:
                transferForm.toGoalId === Number(e.target.value)
                  ? 0
                  : transferForm.toGoalId,
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        >
          <option value={0}>Select fund…</option>
          {goalProjections.map((gp) => (
            <option key={gp.goalId} value={gp.goalId}>
              {gp.name}
            </option>
          ))}
        </select>
      </div>

      {/* To */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">To</label>
        <select
          value={toGoalId}
          onChange={(e) =>
            setTransferForm({
              ...transferForm,
              toGoalId: Number(e.target.value),
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        >
          <option value={0}>Select fund…</option>
          {toGoalOptions.map((gp) => (
            <option key={gp.goalId} value={gp.goalId}>
              {gp.name}
            </option>
          ))}
        </select>
      </div>

      {/* Amount */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">Amount</label>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={transferForm.amount}
          onChange={(e) =>
            setTransferForm({
              ...transferForm,
              amount: e.target.value,
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>
    </>
  );
}

export function TransactionDetailFields({
  addForm,
  setAddForm,
  commitAdd,
  cancelAdd,
}: {
  addForm: typeof defaultAddForm;
  setAddForm: Dispatch<SetStateAction<typeof defaultAddForm>>;
  commitAdd: () => void;
  cancelAdd: () => void;
}) {
  return (
    <>
      {/* Description */}
      <div className="col-span-2 sm:col-span-3">
        <label className="text-caption text-faint mb-0.5 block">
          Description
        </label>
        <input
          type="text"
          placeholder="e.g. Car registration"
          value={addForm.description}
          onChange={(e) =>
            setAddForm({
              ...addForm,
              description: e.target.value,
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") commitAdd();
            if (e.key === "Escape") cancelAdd();
          }}
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Recurring */}
      <div className="col-span-2 flex items-center gap-3 sm:col-span-3">
        <label className="text-muted flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={addForm.isRecurring}
            onChange={(e) =>
              setAddForm({
                ...addForm,
                isRecurring: e.target.checked,
              })
            }
          />
          Recurring
        </label>
        {addForm.isRecurring && (
          <div className="text-muted flex items-center gap-1 text-xs">
            <span>every</span>
            <input
              type="number"
              min={1}
              value={addForm.recurrenceMonths}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                setAddForm({
                  ...addForm,
                  recurrenceMonths:
                    Number.isFinite(parsed) && parsed >= 1
                      ? Math.floor(parsed)
                      : 1,
                });
              }}
              className="border-default bg-surface-primary text-primary w-12 rounded border px-1.5 py-0.5 text-center text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
            <span>months</span>
          </div>
        )}
      </div>
    </>
  );
}

export function TransactionAmountFields({
  addGoalId,
  setAddForm,
  addForm,
  goalProjections,
}: {
  addGoalId: number;
  setAddForm: Dispatch<SetStateAction<typeof defaultAddForm>>;
  addForm: typeof defaultAddForm;
  goalProjections: GoalProjection[];
}) {
  return (
    <>
      {/* Fund */}
      <div className="col-span-2 sm:col-span-1">
        <label className="text-caption text-faint mb-0.5 block">Fund</label>
        <select
          value={addGoalId}
          onChange={(e) =>
            setAddForm({
              ...addForm,
              goalId: Number(e.target.value),
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        >
          {goalProjections.map((gp) => (
            <option key={gp.goalId} value={gp.goalId}>
              {gp.name}
            </option>
          ))}
        </select>
      </div>

      {/* Date */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">Date</label>
        <input
          type="date"
          value={addForm.transactionDate}
          onChange={(e) =>
            setAddForm({
              ...addForm,
              transactionDate: e.target.value,
            })
          }
          className="border-default bg-surface-primary text-primary w-full rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Amount */}
      <div>
        <label className="text-caption text-faint mb-0.5 block">Amount</label>
        <div className="flex items-center gap-1">
          <button
            onClick={() =>
              setAddForm({
                ...addForm,
                isNegative: !addForm.isNegative,
              })
            }
            className={`h-6 w-6 shrink-0 rounded text-xs font-bold ${
              addForm.isNegative
                ? "bg-red-100 text-red-600"
                : "bg-green-100 text-green-600"
            }`}
          >
            {addForm.isNegative ? "−" : "+"}
          </button>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={addForm.amount}
            onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
            className="border-default bg-surface-primary text-primary flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </>
  );
}
