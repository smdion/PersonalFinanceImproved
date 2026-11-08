"use client";

import React from "react";
import { Card } from "@/components/ui/card";
import { FormField, FormInput, FormSelect } from "@/components/forms";
import { NewFundForm } from "./types";
import { SegmentedControl } from "@/components/ui/segmented-control";

const GOAL_TYPES = [
  { value: "fixed", label: "Fixed Goal" },
  { value: "ongoing", label: "Ongoing" },
  { value: "bucket", label: "Bucket" },
] as const;

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormField label="Fund Name">
          <FormInput
            type="text"
            value={newFund.name}
            onChange={(e) => setNewFund({ ...newFund, name: e.target.value })}
            placeholder="e.g. Vacation, New Car"
          />
        </FormField>
        <div>
          <label className="text-muted mb-1 block text-xs">Goal Type</label>
          <SegmentedControl
            look="tray-fill"
            ariaLabel="Goal Type"
            value={newFund.targetMode}
            onChange={(targetMode) =>
              setNewFund(
                targetMode === "fixed"
                  ? { ...newFund, targetMode }
                  : targetMode === "ongoing"
                    ? { ...newFund, targetMode, targetDate: "" }
                    : {
                        ...newFund,
                        targetMode,
                        targetDate: "",
                        targetAmount: "",
                      },
              )
            }
            options={GOAL_TYPES}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
      <div className="mt-3 flex gap-2">
        <button
          onClick={onSubmit}
          disabled={isPending || !newFund.name}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="hover:bg-surface-sunken rounded border px-3 py-1 text-sm"
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
