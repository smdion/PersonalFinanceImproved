"use client";

import React from "react";
import { trpc } from "@/lib/trpc";
import { ContributionGrid } from "./contribution-grid";
import { MonthOverrideModal } from "./month-override-modal";
import type { GoalProjection } from "./types";

/* ── Main AllocationEditorSection ── */

interface AllocationEditorSectionProps {
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
  /** Set of "YYYY-MM" keys for months that have rule-sourced overrides. */
  ruleMonthKeys?: Set<string>;
  hiddenGoalIds?: Set<number>;
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
  ruleMonthKeys,
  hiddenGoalIds,
}: AllocationEditorSectionProps) {
  const utils = trpc.useUtils();
  const basePool = maxMonthlyFunding ?? totalMonthlyAllocation;

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
          ruleMonthKeys={ruleMonthKeys}
          hiddenGoalIds={hiddenGoalIds}
        />
      )}

      {editingMonth && (
        <MonthOverrideModal
          key={`${editingMonth.getFullYear()}-${editingMonth.getMonth()}`}
          monthDate={editingMonth}
          monthDates={monthDates}
          goalProjections={goalProjections}
          pool={
            monthlyPools[
              monthDates.findIndex(
                (d) =>
                  d.getFullYear() === editingMonth.getFullYear() &&
                  d.getMonth() === editingMonth.getMonth(),
              )
            ] ?? basePool
          }
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
