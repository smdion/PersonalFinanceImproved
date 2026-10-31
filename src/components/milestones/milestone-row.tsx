"use client";

import { useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FocusLink } from "@/components/ui/focus-link";
import { useScrollToFocus } from "@/components/ui/focus-target";
import { FOCUS_HOMES } from "@/lib/config/focus-topics";
import { useFocusMatch, useFocusReveal } from "@/lib/hooks/use-focus";
import {
  Check,
  ChevronRight,
  CircleDashed,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { ProgressBar } from "@/components/ui/card";
import { MILESTONE_SOURCE_LABELS } from "@/lib/config/milestones";
import { MILESTONE_STATUS_LABELS } from "@/lib/config/display-labels";
import { STATUS_COLORS } from "@/lib/utils/colors";
import { formatDate } from "@/lib/utils/format";
import type { MilestoneResult, MilestoneStatus } from "@/lib/pure/milestones";

export const STATUS_STYLE: Record<
  MilestoneStatus,
  {
    chip: string;
    icon: string;
    /** Left edge of the row: status at a glance. */
    rail: string;
    bar: "success" | "info" | "warning" | "default";
  }
> = {
  reached: {
    chip: `${STATUS_COLORS.green.bg} ${STATUS_COLORS.green.text}`,
    icon: STATUS_COLORS.green.text,
    rail: "border-l-green-500",
    bar: "success",
  },
  onTrack: {
    chip: `${STATUS_COLORS.blue.bg} ${STATUS_COLORS.blue.text}`,
    icon: STATUS_COLORS.blue.text,
    rail: "border-l-blue-500",
    bar: "info",
  },
  behind: {
    chip: `${STATUS_COLORS.amber.bg} ${STATUS_COLORS.amber.text}`,
    icon: STATUS_COLORS.amber.text,
    rail: "border-l-amber-500",
    bar: "warning",
  },
  unknown: {
    chip: "bg-surface-elevated text-muted",
    icon: "text-faint",
    rail: "border-l-transparent",
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
  firstReached,
}: {
  result: MilestoneResult;
  /** The day it was first reached, when recorded; `isNew` marks it. */
  firstReached?: { date: string; isNew: boolean } | null;
  /** Extra controls in the open row (e.g. remove a custom goal). */
  extra?: ReactNode;
  /** Extra detail in the open row (e.g. the savings-rate breakdown). */
  detail?: ReactNode;
}) {
  // A link to this milestone opens it and scrolls to it.
  const isThis = (ids: { milestoneId: string }) =>
    ids.milestoneId === result.id;
  const [open, setOpen] = useFocusReveal("milestone", isThis);
  const linked = useFocusMatch("milestone");
  const rowRef = useRef<HTMLDivElement>(null);
  useScrollToFocus(rowRef, linked !== null && isThis(linked));
  const pathname = usePathname();
  const style = STATUS_STYLE[result.status];
  const when =
    result.status === "reached"
      ? result.note
      : (result.note ??
        (result.expectedYear ? `Expected ${result.expectedYear}` : null));
  // Reached and on-track read from the icon and the line under the value;
  // only the exceptions carry a word.
  const showPill = result.status === "behind" || result.status === "unknown";
  const showBar =
    result.progress !== null &&
    result.status !== "reached" &&
    result.status !== "unknown";
  return (
    <div
      ref={rowRef}
      className={`border-l-2 pl-2 ${style.rail} ${open ? "bg-surface-sunken rounded-r" : ""}`}
    >
      <button
        type="button"
        className="hover:bg-surface-sunken grid w-full grid-cols-[1rem_minmax(0,1fr)_auto_1rem] items-start gap-x-2.5 rounded-r py-2 pr-1 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="mt-0.5">
          <StatusIcon status={result.status} />
        </span>
        <span className="min-w-0">
          <span className="text-primary block text-sm font-medium">
            {result.title}
            {firstReached?.isNew && (
              <span
                className={`text-caption ml-1.5 rounded-full bg-purple-100 px-1.5 py-0.5 font-medium text-purple-700`}
              >
                New
              </span>
            )}
          </span>
          <span className="text-secondary block text-xs tabular-nums">
            {result.headline}
          </span>
          {showBar && (
            <span className="mt-1 block max-w-xs">
              <ProgressBar
                value={result.progress!}
                variant={style.bar}
                small
                inline
              />
            </span>
          )}
          <span className="text-caption text-muted block">
            {[when, MILESTONE_SOURCE_LABELS[result.source]]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="mt-0.5">
          {showPill && (
            <span
              className={`text-caption rounded-full px-1.5 py-0.5 font-medium whitespace-nowrap ${style.chip}`}
            >
              {MILESTONE_STATUS_LABELS[result.status]}
            </span>
          )}
        </span>
        <ChevronRight
          className={`text-muted mt-0.5 h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="text-secondary space-y-1.5 pr-2 pb-3 pl-7 text-xs">
          <p>{result.rule}</p>
          {firstReached && (
            <p className="text-muted">
              First reached {formatDate(firstReached.date, "medium")}
            </p>
          )}
          {detail}
          {result.adaptedNote && (
            <p className="text-muted">{result.adaptedNote}</p>
          )}
          {result.nextStep && (
            <p>
              <span className="text-primary font-medium">Next step: </span>
              {result.nextStepFocus ? (
                <FocusLink
                  focus={result.nextStepFocus}
                  className="text-blue-600 hover:underline"
                >
                  {result.nextStep}
                </FocusLink>
              ) : (
                result.nextStep
              )}
            </p>
          )}
          <div className="flex items-center gap-3">
            {FOCUS_HOMES[result.focus.topic].route !== pathname && (
              <FocusLink
                focus={result.focus}
                className="text-blue-600 hover:underline"
              >
                Go there →
              </FocusLink>
            )}
            {extra}
          </div>
        </div>
      )}
    </div>
  );
}
