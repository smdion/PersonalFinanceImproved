"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { describeCheck, PERF_FIELD_HELP } from "@/lib/config/performance-help";
import type { PerfCheck } from "@/lib/pure/performance-checks";
import type { PerfField } from "@/lib/pure/performance-annotations";

/**
 * A Performance account row's reconciliation checks, note and estimated
 * figures at a glance: amber with the count while any check is open, a
 * quiet mark when there's only a note, estimates or accepted gaps. Hover for
 * the details; click (editors) to open the row's notes and checks.
 */
export function CheckBadge({
  checks,
  note,
  estimatedFields,
  onOpen,
}: {
  checks: PerfCheck[];
  note: string | null;
  estimatedFields: PerfField[];
  onOpen?: () => void;
}) {
  const open = checks.filter((c) => !c.accepted);
  const hasAnything = checks.length > 0 || !!note || estimatedFields.length > 0;
  if (!hasAnything && !onOpen) return null;

  const label = open.length > 0 ? `⚠ ${open.length}` : hasAnything ? "✎" : "+";
  const tone =
    open.length > 0
      ? "bg-amber-100 text-amber-800"
      : hasAnything
        ? "bg-surface-strong text-muted"
        : "text-faint opacity-0 group-hover:opacity-100 focus:opacity-100";
  const aria = [
    open.length > 0 &&
      `${open.length} check${open.length === 1 ? "" : "s"} to look at`,
    note && "has a note",
    estimatedFields.length > 0 && "has estimated figures",
  ]
    .filter(Boolean)
    .join(", ");
  const className = `text-caption inline-flex items-center rounded-full px-1.5 font-semibold ${tone} ${onOpen ? "cursor-pointer" : "cursor-help"}`;

  const content = hasAnything ? (
    <div className="flex flex-col gap-2">
      {checks.map((c) => {
        const d = describeCheck(c);
        return (
          <div key={c.kind}>
            <div className="font-semibold">
              {d.title}
              {c.accepted && " — accepted"}
            </div>
            <div className="opacity-80">{d.help}</div>
          </div>
        );
      })}
      {estimatedFields.length > 0 && (
        <div>
          <span className="font-semibold">Estimated: </span>
          {estimatedFields.map((f) => PERF_FIELD_HELP[f].label).join(", ")}
        </div>
      )}
      {note && <div className="whitespace-pre-wrap italic">{note}</div>}
      {onOpen && (
        <div className="opacity-70">Click to add notes or accept a gap.</div>
      )}
    </div>
  ) : (
    "Add a note or mark figures as estimated"
  );

  return (
    <Tooltip maxWidth={360} content={content}>
      {onOpen ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`Notes and checks${aria ? ` (${aria})` : ""}`}
          className={className}
        >
          {label}
        </button>
      ) : (
        <span role="note" aria-label={aria} className={className}>
          {label}
        </span>
      )}
    </Tooltip>
  );
}
