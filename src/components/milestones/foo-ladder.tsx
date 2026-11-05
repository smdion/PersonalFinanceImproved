"use client";

import {
  currentFooStep,
  type MilestoneResult,
} from "@/lib/pure/advice/milestones/milestones";
import { MILESTONE_STATUS_LABELS } from "@/lib/config/display-labels";
import { STATUS_STYLE, StatusIcon } from "./milestone-row";

/** The nine FOO steps in a row, the one you're on outlined. */
export function FooLadder({ results }: { results: MilestoneResult[] }) {
  const steps = Array.from({ length: 9 }, (_, i) =>
    results.find((r) => r.id === `foo${i + 1}`),
  ).filter((r): r is MilestoneResult => r !== undefined);
  const current = currentFooStep(results);
  const done = steps.filter((s) => s.status === "reached").length;
  return (
    <div>
      <p className="text-muted mb-2 text-xs">
        {current === null
          ? `${done} of 9 steps done — nothing left behind.`
          : `You're on step ${current}. ${done} of 9 done.`}{" "}
        Step zero is generosity. The Bogleheads&apos; investing order is much
        the same, and they stress it&apos;s a guide, not a rule.
      </p>
      <ol className="grid grid-cols-3 gap-1.5 lg:grid-cols-5 xl:grid-cols-9">
        {steps.map((s, i) => {
          const isCurrent = current === i + 1;
          return (
            <li
              key={s.id}
              title={`${s.title}: ${s.headline}`}
              className={`rounded border px-2 py-1.5 ${
                isCurrent
                  ? "bg-surface-sunken border-blue-500 ring-1 ring-blue-500"
                  : "border-default"
              }`}
            >
              {/* Same three slots in every step, so the row lines up:
                  step number, a two-line title, then the detail (never cut off). */}
              <div className="text-caption text-muted flex items-center gap-1.5">
                <StatusIcon status={s.status} />
                <span className="sr-only">
                  {MILESTONE_STATUS_LABELS[s.status]}
                </span>
                Step {i + 1}
              </div>
              <div
                className="text-primary mt-1 line-clamp-2 min-h-[2.5em] text-xs leading-tight font-medium"
                title={s.title}
              >
                {s.title.replace(/^\d+\s*·\s*/, "")}
              </div>
              <div
                className={`text-caption mt-0.5 min-h-[2.75em] leading-snug ${STATUS_STYLE[s.status].icon}`}
              >
                {s.short}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
