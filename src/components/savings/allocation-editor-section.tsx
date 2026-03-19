"use client";

import React from "react";
import { trpc } from "@/lib/trpc";
import { ContributionGrid } from "./contribution-grid";
import { MonthOverrideModal } from "./month-override-modal";
import type { GoalProjection } from "./types";

export interface AllocationEditorSectionProps {
  goalProjections: GoalProjection[];
  monthDates: Date[];
  totalMonthlyAllocation: number;
  maxMonthlyFunding: number | null;
  monthlyPools: number[];
  canEdit: boolean;
  onGoalUpdate: (goalId: number, field: string, value: string) => void;
  onGoalUpdateMulti: (goalId: number, fields: Record<string, string>) => void;
  editingMonth: Date | null;
  setEditingMonth: (d: Date | null) => void;
}

export function AllocationEditorSection({
  goalProjections,
  monthDates,
  totalMonthlyAllocation,
  maxMonthlyFunding,
  monthlyPools,
  canEdit,
  onGoalUpdate,
  onGoalUpdateMulti,
  editingMonth,
  setEditingMonth,
}: AllocationEditorSectionProps) {
  const utils = trpc.useUtils();

  // ── Mutations ──
  const upsertMonth = trpc.savings.allocationOverrides.upsertMonth.useMutation({
    onSuccess: () => utils.savings.invalidate(),
  });
  const upsertMonthRange =
    trpc.savings.allocationOverrides.upsertMonthRange.useMutation({
      onSuccess: () => utils.savings.invalidate(),
    });
  const deleteMonthOverrides =
    trpc.savings.allocationOverrides.deleteMonth.useMutation({
      onSuccess: () => utils.savings.invalidate(),
    });

  return (
    <>
      {goalProjections.length > 0 && (
        <ContributionGrid
          goalProjections={goalProjections}
          monthDates={monthDates}
          totalMonthlyAllocation={totalMonthlyAllocation}
          maxMonthlyFunding={maxMonthlyFunding}
          monthlyPools={monthlyPools}
          onGoalUpdate={onGoalUpdate}
          onGoalUpdateMulti={onGoalUpdateMulti}
          onEditMonth={setEditingMonth}
          canEdit={canEdit}
        />
      )}

      {editingMonth && (
        <MonthOverrideModal
          monthDate={editingMonth}
          monthDates={monthDates}
          goalProjections={goalProjections}
          pool={maxMonthlyFunding ?? totalMonthlyAllocation}
          onUpsertMonth={(p) => upsertMonth.mutate(p)}
          onUpsertMonthRange={(p) => upsertMonthRange.mutate(p)}
          onDeleteMonthOverrides={(monthDates) => {
            deleteMonthOverrides.mutate({ monthDates });
          }}
          onClose={() => setEditingMonth(null)}
        />
      )}
    </>
  );
}
