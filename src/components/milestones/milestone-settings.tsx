"use client";

/** The household's own goals and the milestone checklist — admins edit,
 *  everyone else sees them. Saved to app_settings, validated on write. */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  CUSTOM_GOAL_METRICS,
  MAX_CUSTOM_GOALS,
  MILESTONE_CHECKLIST_ITEMS,
  type CustomGoalMetric,
  type MilestoneChecklistItem,
} from "@/lib/config/milestones";
import {
  SK_MILESTONE_CHECKLIST,
  SK_MILESTONE_CUSTOM_GOALS,
} from "@/lib/constants/settings-keys";
import type { CustomGoal, MilestoneChecklist } from "@/lib/pure/milestones";
import { toast } from "@/lib/hooks/use-toast";

function useSaveMilestoneSetting() {
  const utils = trpc.useUtils();
  return trpc.settings.appSettings.upsert.useMutation({
    onSuccess: () => {
      void utils.milestones.computeInputs.invalidate();
      void utils.settings.appSettings.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
}

export function MilestoneChecklistEditor({
  checklist,
  canEdit,
}: {
  checklist: MilestoneChecklist;
  canEdit: boolean;
}) {
  const save = useSaveMilestoneSetting();
  const toggle = (key: MilestoneChecklistItem) =>
    save.mutate({
      key: SK_MILESTONE_CHECKLIST,
      value: { ...checklist, [key]: !checklist[key] },
    });
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {(
        Object.entries(MILESTONE_CHECKLIST_ITEMS) as [
          MilestoneChecklistItem,
          string,
        ][]
      ).map(([key, label]) => (
        <li key={key}>
          <label className="text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checklist[key] === true}
              disabled={!canEdit || save.isPending}
              onChange={() => toggle(key)}
            />
            {label}
          </label>
        </li>
      ))}
    </ul>
  );
}

export function useCustomGoalActions(goals: CustomGoal[]) {
  const save = useSaveMilestoneSetting();
  return {
    isPending: save.isPending,
    add: (goal: Omit<CustomGoal, "id">) =>
      save.mutate({
        key: SK_MILESTONE_CUSTOM_GOALS,
        value: [...goals, { ...goal, id: Date.now().toString(36) }],
      }),
    remove: (id: string) =>
      save.mutate({
        key: SK_MILESTONE_CUSTOM_GOALS,
        value: goals.filter((g) => g.id !== id),
      }),
  };
}

export function AddCustomGoal({
  goals,
  asOfYear,
}: {
  goals: CustomGoal[];
  asOfYear: number;
}) {
  const actions = useCustomGoalActions(goals);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [metric, setMetric] = useState<CustomGoalMetric>("liquid");
  const [target, setTarget] = useState("");
  const [todaysDollars, setTodaysDollars] = useState(false);
  const amount = Number(target);
  const valid = label.trim().length > 0 && amount > 0;

  if (goals.length >= MAX_CUSTOM_GOALS) return null;
  if (!open)
    return (
      <button
        type="button"
        className="text-caption text-blue-600 hover:underline"
        onClick={() => setOpen(true)}
      >
        + Add a goal
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        actions.add({
          label: label.trim(),
          metric,
          target: amount,
          todaysDollars,
          setYear: asOfYear,
        });
        setOpen(false);
        setLabel("");
        setTarget("");
      }}
    >
      <label className="flex flex-col">
        <span className="text-caption text-muted">Name</span>
        <input
          className="bg-surface-primary rounded border px-1.5 py-0.5"
          value={label}
          maxLength={60}
          placeholder="Half a million invested"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="flex flex-col">
        <span className="text-caption text-muted">What</span>
        <select
          className="bg-surface-primary rounded border px-1.5 py-0.5"
          value={metric}
          onChange={(e) => setMetric(e.target.value as CustomGoalMetric)}
        >
          {Object.entries(CUSTOM_GOAL_METRICS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col">
        <span className="text-caption text-muted">Target ($)</span>
        <input
          type="number"
          min={1}
          className="bg-surface-primary w-32 rounded border px-1.5 py-0.5"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>
      <label className="text-secondary flex items-center gap-1 pb-1 text-xs">
        <input
          type="checkbox"
          checked={todaysDollars}
          onChange={(e) => setTodaysDollars(e.target.checked)}
        />
        In today&apos;s dollars
      </label>
      <button
        type="submit"
        disabled={!valid || actions.isPending}
        className="rounded bg-blue-600 px-2 py-0.5 text-white disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        className="text-muted px-1"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </form>
  );
}
