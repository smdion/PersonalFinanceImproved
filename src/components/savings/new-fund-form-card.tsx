"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { NewFundForm } from "./types";

export function NewFundFormCard({
  newFund,
  setNewFund,
  onSubmit,
  onCancel,
  isPending,
  availableParents,
}: {
  newFund: NewFundForm;
  setNewFund: (form: NewFundForm) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isPending: boolean;
  availableParents?: { id: number; name: string }[];
}) {
  const isFixed = newFund.targetMode === "fixed";
  const isOngoing = newFund.targetMode === "ongoing";
  const isBucket = newFund.targetMode === "bucket";

  return (
    <Card title="Create New Sinking Fund" className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Fund Name</label>
          <input
            type="text"
            value={newFund.name}
            onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
            placeholder="e.g. Vacation, New Car"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        {!isBucket && (
          <div>
            <label className="block text-xs text-muted mb-1">
              Monthly Contribution
            </label>
            <input
              type="number"
              step="0.01"
              value={newFund.monthlyContribution}
              onChange={(e) =>
                setNewFund({ ...newFund, monthlyContribution: e.target.value })
              }
              placeholder="500"
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-muted mb-1">Goal Type</label>
          <div className="flex bg-surface-elevated rounded p-0.5">
            <button
              type="button"
              onClick={() => setNewFund({ ...newFund, targetMode: "fixed" })}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                isFixed
                  ? "bg-surface-primary text-primary shadow-sm font-medium"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Fixed Goal
            </button>
            <button
              type="button"
              onClick={() =>
                setNewFund({
                  ...newFund,
                  targetMode: "ongoing",
                  targetDate: "",
                })
              }
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                isOngoing
                  ? "bg-surface-primary text-primary shadow-sm font-medium"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Ongoing
            </button>
            <button
              type="button"
              onClick={() =>
                setNewFund({
                  ...newFund,
                  targetMode: "bucket",
                  targetDate: "",
                  targetAmount: "",
                  monthlyContribution: "",
                })
              }
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                isBucket
                  ? "bg-surface-primary text-primary shadow-sm font-medium"
                  : "text-muted hover:text-secondary"
              }`}
            >
              Bucket
            </button>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
        {!isBucket && (
          <div>
            <label className="block text-xs text-muted mb-1">
              Target Amount {isOngoing && "(maintain level)"}
            </label>
            <input
              type="number"
              step="0.01"
              value={newFund.targetAmount}
              onChange={(e) =>
                setNewFund({ ...newFund, targetAmount: e.target.value })
              }
              placeholder={isFixed ? "10000" : "2000"}
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
        )}
        {isFixed && (
          <div>
            <label className="block text-xs text-muted mb-1">Target Date</label>
            <input
              type="date"
              value={newFund.targetDate}
              onChange={(e) =>
                setNewFund({ ...newFund, targetDate: e.target.value })
              }
              className="w-full border rounded px-2 py-1 text-sm"
            />
            <p className="text-[10px] text-faint mt-0.5">
              No date = should be funded now
            </p>
          </div>
        )}
        {availableParents && availableParents.length > 0 && (
          <div>
            <label className="block text-xs text-muted mb-1">Parent Fund</label>
            <select
              value={newFund.parentGoalId ?? ""}
              onChange={(e) =>
                setNewFund({
                  ...newFund,
                  parentGoalId: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="w-full border rounded px-2 py-1 text-sm"
            >
              <option value="">None (top-level fund)</option>
              {availableParents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onSubmit}
          disabled={isPending || !newFund.name}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 border rounded text-sm hover:bg-surface-sunken"
        >
          Cancel
        </button>
      </div>
    </Card>
  );
}
