"use client";

/** Milestones page body: what's next and what's been reached, the FOO
 *  ladder, then every milestone by group. */
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingCard, ErrorCard } from "@/components/cards/dashboard/utils";
import { useUser, isAdmin, hasPermission } from "@/lib/context/user-context";
import { useMilestones } from "@/lib/hooks/use-milestones";
import {
  MILESTONE_GROUPS,
  MILESTONE_SOURCE_LABELS,
  type MilestoneSource,
} from "@/lib/config/milestones";
import { MilestoneRow } from "@/components/milestones/milestone-row";
import { FooLadder } from "@/components/milestones/foo-ladder";
import { MilestonesHero } from "@/components/milestones/milestones-hero";
import {
  AddCustomGoal,
  MilestoneChecklistEditor,
  useCustomGoalActions,
} from "@/components/milestones/milestone-settings";

const SOURCES: MilestoneSource[] = [
  "moneyGuy",
  "bogleheads",
  "fidelity",
  "custom",
];

export function MilestonesContent() {
  const user = useUser();
  const canEdit = isAdmin(user);
  const { isLoading, projectionLoading, error, input, results } = useMilestones(
    {
      withHoldings: hasPermission(user, "portfolio"),
    },
  );
  const [source, setSource] = useState<MilestoneSource | null>(null);
  const [hideUnknown, setHideUnknown] = useState(false);
  const goalActions = useCustomGoalActions(input?.customGoals ?? []);

  const header = (
    <PageHeader
      title="Milestones"
      subtitle="What you've reached, where you stand, and what's next — The Money Guy Show's and the Bogleheads' rules, plus your own goals"
    />
  );
  if (isLoading)
    return (
      <div>
        {header}
        <LoadingCard title="Milestones" />
      </div>
    );
  if (error || !input)
    return (
      <div>
        {header}
        <ErrorCard title="Milestones" message="Failed to load" />
      </div>
    );
  if (results.length === 0)
    return (
      <div>
        {header}
        <EmptyState
          message="No history yet."
          hint="Add people, a paycheck and a portfolio snapshot to see your milestones."
        />
      </div>
    );

  const shown = results.filter(
    (r) =>
      (source === null || r.source === source) &&
      !(hideUnknown && r.status === "unknown"),
  );
  const fooResults = results.filter((r) => r.group === "foo");

  return (
    <div className="space-y-3">
      {header}
      {projectionLoading && (
        <p className="text-muted text-xs">Working out expected dates…</p>
      )}
      <MilestonesHero results={results} input={input} />

      {(source === null || source === "moneyGuy") && (
        <Card title="Financial Order of Operations">
          <FooLadder results={fooResults} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button
          type="button"
          onClick={() => setSource(null)}
          className={`rounded-full border px-2 py-0.5 ${source === null ? "border-blue-500 text-blue-700" : "text-muted"}`}
        >
          All
        </button>
        {SOURCES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(source === s ? null : s)}
            className={`rounded-full border px-2 py-0.5 ${source === s ? "border-blue-500 text-blue-700" : "text-muted"}`}
          >
            {MILESTONE_SOURCE_LABELS[s]}
          </button>
        ))}
        <label className="text-muted ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={hideUnknown}
            onChange={(e) => setHideUnknown(e.target.checked)}
          />
          Hide &ldquo;not enough data&rdquo;
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {MILESTONE_GROUPS.filter((g) => g.key !== "foo").map((g) => {
          const rows = shown.filter((r) => r.group === g.key);
          const isGoals = g.key === "custom";
          const canAddGoal =
            isGoals && canEdit && (source === null || source === "custom");
          if (rows.length === 0 && !canAddGoal) return null;
          return (
            <Card key={g.key} title={g.title} subtitle={g.blurb}>
              {rows.map((r) => (
                <MilestoneRow
                  key={r.id}
                  result={r}
                  extra={
                    isGoals && canEdit ? (
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        disabled={goalActions.isPending}
                        onClick={() =>
                          goalActions.remove(r.id.replace(/^custom:/, ""))
                        }
                      >
                        Remove goal
                      </button>
                    ) : undefined
                  }
                />
              ))}
              {canAddGoal && (
                <div className="mt-2">
                  <AddCustomGoal
                    goals={input.customGoals}
                    asOfYear={input.asOfYear}
                  />
                </div>
              )}
            </Card>
          );
        })}
        <Card
          title="Checklist"
          subtitle={
            canEdit
              ? "Things Ledgr can't see — tick them off as they're done."
              : "Ticked by an admin."
          }
        >
          <MilestoneChecklistEditor
            checklist={input.checklist}
            canEdit={canEdit}
          />
        </Card>
      </div>
    </div>
  );
}
