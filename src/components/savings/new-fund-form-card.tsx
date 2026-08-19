"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { FormField, FormInput, FormSelect } from "@/components/forms";
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
        <FormField label="Fund Name">
          <FormInput
            type="text"
            value={newFund.name}
            onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
            placeholder="e.g. Vacation, New Car"
          />
        </FormField>
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
          <FormField
            label={`Target Amount${isOngoing ? " (maintain level)" : ""}`}
          >
            <FormInput
              type="number"
              step="0.01"
              value={newFund.targetAmount}
              onChange={(e) =>
                setNewFund({ ...newFund, targetAmount: e.target.value })
              }
              placeholder={isFixed ? "10000" : "2000"}
            />
          </FormField>
        )}
        {isFixed && (
          <FormField label="Target Date" help="No date = should be funded now">
            <FormInput
              type="date"
              value={newFund.targetDate}
              onChange={(e) =>
                setNewFund({ ...newFund, targetDate: e.target.value })
              }
            />
          </FormField>
        )}
        {availableParents && availableParents.length > 0 && (
          <FormField label="Parent Fund">
            <FormSelect
              value={newFund.parentGoalId ?? ""}
              onChange={(e) =>
                setNewFund({
                  ...newFund,
                  parentGoalId: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">None (top-level fund)</option>
              {availableParents.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </FormSelect>
          </FormField>
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
      <p className="text-caption text-faint mt-2">
        New funds start at $0 for every budget profile — set how much each
        profile funds this goal from the Savings Profiles tab after creating it.
      </p>
    </Card>
  );
}
