"use client";

/** Milestones page body: what's next and what's been reached, the FOO
 *  ladder, then every milestone by group. */
import { useFirstReached } from "@/app/(dashboard)/milestones/use-first-reached";
import { RaiseHistoryTable } from "@/components/milestones/raise-history-table";
import { AlwaysBuyingDetail } from "@/components/milestones/always-buying-detail";
import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclaimer } from "@/components/ui/disclaimer";
import { LoadingCard, ErrorCard } from "@/components/dashboard/utils";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { useMilestones } from "@/lib/hooks/use-milestones";
import {
  MILESTONE_GROUPS,
  MILESTONE_SOURCE_LABELS,
  type MilestoneSource,
} from "@/lib/config/milestones";
import { MilestoneRow } from "@/components/milestones/milestone-row";
import {
  BalancedColumns,
  type ColumnItem,
} from "@/components/ui/balanced-columns";
import { ChipToggle } from "@/components/ui/chip-toggle";
import { SavingsRateBreakdown } from "@/components/dashboard/savings-rate-breakdown";
import { FooLadder } from "@/components/milestones/foo-ladder";
import { MilestonesHero } from "@/components/milestones/milestones-hero";
import {
  AddCustomGoal,
  CheckpointSourcePicker,
  SavingsTargetSourcePicker,
  MilestoneChecklistEditor,
  useCustomGoalActions,
} from "@/components/milestones/milestone-settings";

/** Wins first, then what's coming; what's behind last (Recommendations
 *  covers what to do about it). */
const STATUS_RANK = { reached: 0, onTrack: 1, unknown: 2, behind: 3 } as const;

const SOURCES: MilestoneSource[] = [
  "moneyGuy",
  "personalFinance",
  "bogleheads",
  "fidelity",
  "custom",
];

export function MilestonesContent() {
  const user = useUser();
  const canEdit = isAdmin(user);
  const { isLoading, projectionLoading, error, input, results } =
    useMilestones();
  const firstReachedOf = useFirstReached();
  const [source, setSource] = useState<MilestoneSource | null>(null);
  const [hideUnknown, setHideUnknown] = useState(false);
  const goalActions = useCustomGoalActions(input?.customGoals ?? []);

  const header = (
    <PageHeader
      title="Milestones"
      subtitle="What you've reached, where you stand, and what's next — The Money Guy Show's and the Bogleheads' rules, plus your own goals"
    >
      <Link
        href="/recommendations"
        className="text-caption text-blue-600 hover:underline"
      >
        What to do → Recommendations
      </Link>
    </PageHeader>
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

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-caption text-muted mr-1">Source</span>
        {[null, ...SOURCES].map((s) => (
          <button
            key={s ?? "all"}
            type="button"
            onClick={() => setSource(s === null || source === s ? null : s)}
            className={`text-caption rounded-full border px-2 py-0.5 whitespace-nowrap transition-colors ${
              source === s
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-default text-muted hover:text-secondary"
            }`}
          >
            {s === null ? "All" : MILESTONE_SOURCE_LABELS[s]}
          </button>
        ))}
        <span className="ml-auto">
          <ChipToggle
            isChecked={hideUnknown}
            onChange={setHideUnknown}
            label="Hide not enough data"
          />
        </span>
      </div>

      {/* Two columns that end level, whatever the cards hold. */}
      <BalancedColumns
        items={MILESTONE_GROUPS.filter((g) => g.key !== "foo")
          .flatMap<ColumnItem>((g) => {
            const rows = shown.filter((r) => r.group === g.key);
            // The journey keeps its order — the sequence is the point.
            const ordered =
              g.key === "journey"
                ? rows
                : [...rows].sort(
                    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
                  );
            const isGoals = g.key === "custom";
            const canAddGoal =
              isGoals && canEdit && (source === null || source === "custom");
            if (rows.length === 0 && !canAddGoal) return [];
            const picker =
              g.key === "wealth" ? (
                <CheckpointSourcePicker
                  source={input.checkpointSource}
                  canEdit={canEdit}
                />
              ) : g.key === "saving" ? (
                <SavingsTargetSourcePicker
                  source={input.savingsTargetSource}
                  canEdit={canEdit}
                />
              ) : null;
            const renderRow = (r: (typeof rows)[number]) => (
              <MilestoneRow
                key={r.id}
                result={r}
                firstReached={firstReachedOf(r.id)}
                detail={
                  (r.id === "savingsRate" || r.id === "pfRetirementRate") &&
                  input.savings ? (
                    <SavingsRateBreakdown
                      savings={input.savings.breakdown}
                      viewMode="projected"
                      excludeMatch={!input.savings.matchCounted}
                      includePortfolio
                      highIncome={input.savings.highIncome}
                      highIncomeThreshold={input.savings.highIncomeThreshold}
                    />
                  ) : r.id === "saveRaises" && input.raises ? (
                    <RaiseHistoryTable raises={input.raises} />
                  ) : r.id === "alwaysBuying" && input.buying ? (
                    <AlwaysBuyingDetail
                      months={input.buying.months}
                      downYears={input.buying.downYears}
                    />
                  ) : undefined
                }
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
            );
            const card = (
              <Card
                title={g.title}
                subtitle={g.blurb}
                headerRight={
                  picker ? (
                    <span className="hidden sm:block">{picker}</span>
                  ) : undefined
                }
              >
                {/* On a phone the rule picker gets its own line. */}
                {picker && <div className="mb-2 sm:hidden">{picker}</div>}
                {ordered.map((r) => renderRow(r))}
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
            return [
              {
                key: g.key,
                node: card,
                // A first guess: header, rows, the progress bars.
                weight:
                  2 +
                  rows.length * 1.2 +
                  rows.filter((r) => r.progress !== null).length * 0.3,
              },
            ];
          })
          .concat({
            key: "checklist",
            // A card like the rest: it joins whichever column ends shorter.
            node: (
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
            ),
            weight: 2 + Object.keys(input.checklist).length * 0.6,
          })}
      />
      <Disclaimer />
    </div>
  );
}
