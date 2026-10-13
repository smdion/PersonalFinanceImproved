"use client";

import { useState, type ReactNode } from "react";
import { Check, CircleDashed, TrendingUp, TriangleAlert } from "lucide-react";
import { ProgressBar } from "@/components/ui/card";
import { MILESTONE_SOURCE_LABELS } from "@/lib/config/milestones";
import { MILESTONE_STATUS_LABELS } from "@/lib/config/display-labels";
import { STATUS_COLORS } from "@/lib/utils/colors";
import type { MilestoneResult, MilestoneStatus } from "@/lib/pure/milestones";

export const STATUS_STYLE: Record<
  MilestoneStatus,
  {
    chip: string;
    icon: string;
    bar: "success" | "info" | "warning" | "default";
  }
> = {
  reached: {
    chip: `${STATUS_COLORS.green.bg} ${STATUS_COLORS.green.text}`,
    icon: STATUS_COLORS.green.text,
    bar: "success",
  },
  onTrack: {
    chip: `${STATUS_COLORS.blue.bg} ${STATUS_COLORS.blue.text}`,
    icon: STATUS_COLORS.blue.text,
    bar: "info",
  },
  behind: {
    chip: `${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.text}`,
    icon: STATUS_COLORS.amber.text,
    bar: "warning",
  },
  unknown: {
    chip: "bg-surface-elevated text-muted",
    icon: "text-faint",
    bar: "default",
  },
};

export function StatusIcon({ status }: { status: MilestoneStatus }) {
  const className = `h-4 w-4 flex-shrink-0 ${STATUS_STYLE[status].icon}`;
  if (status === "reached") return <Check className={className} aria-hidden />;
  if (status === "onTrack")
    return <TrendingUp className={className} aria-hidden />;
  if (status === "behind")
    return <TriangleAlert className={className} aria-hidden />;
  return <CircleDashed className={className} aria-hidden />;
}

/** One milestone: a compact line that opens into how it's figured and what
 *  gets you there sooner. */
export function MilestoneRow({
  result,
  extra,
  detail,
}: {
  result: MilestoneResult;
  /** Extra controls in the open row (e.g. remove a custom goal). */
  extra?: ReactNode;
  /** Extra detail in the open row (e.g. the savings-rate breakdown). */
  detail?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[result.status];
  const when =
    result.status === "reached"
      ? result.note
      : (result.note ??
        (result.expectedYear ? `Expected ${result.expectedYear}` : null));
  return (
    <div className="border-subtle border-b last:border-b-0">
      <button
        type="button"
        className="hover:bg-surface-sunken -mx-1 flex w-full items-center gap-2 rounded px-1 py-1.5 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <StatusIcon status={result.status} />
        <span className="text-primary min-w-0 flex-1 text-sm">
          {result.title}
          <span className="text-faint ml-1.5 text-xs">
            {MILESTONE_SOURCE_LABELS[result.source]}
          </span>
        </span>
        <span className="hidden text-right sm:block">
          <span className="text-secondary text-sm">{result.headline}</span>
          {when && (
            <span className="text-micro text-faint block leading-tight">
              {when}
            </span>
          )}
        </span>
        <span
          className={`text-caption rounded-full px-1.5 py-0.5 font-medium whitespace-nowrap ${style.chip}`}
        >
          {MILESTONE_STATUS_LABELS[result.status]}
        </span>
        <span className="text-faint text-xs" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="text-secondary space-y-1.5 pb-3 pl-6 text-xs">
          <p className="sm:hidden">
            <span className="text-primary">{result.headline}</span>
            {when ? ` · ${when}` : ""}
          </p>
          {result.progress !== null && result.status !== "reached" && (
            <ProgressBar value={result.progress} variant={style.bar} small />
          )}
          <p>{result.rule}</p>
          {detail}
          {result.adaptedNote && (
            <p className="text-muted">{result.adaptedNote}</p>
          )}
          {result.nextStep && (
            <p>
              <span className="text-primary font-medium">Next step: </span>
              {result.nextStep}
            </p>
          )}
          <div className="flex items-center gap-3">
            {result.href !== "/milestones" && (
              <a href={result.href} className="text-blue-600 hover:underline">
                Go there →
              </a>
            )}
            {extra}
          </div>
        </div>
      )}
    </div>
  );
}
