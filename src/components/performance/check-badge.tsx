"use client";

import { Tooltip } from "@/components/ui/tooltip";
import { describeCheck } from "@/lib/config/performance-help";
import type { PerfCheck } from "@/lib/pure/performance-checks";

/** Reconciliation checks on a Performance account row: amber when any is
 *  open, muted when every one has been accepted. Nothing when clean. */
export function CheckBadge({ checks }: { checks: PerfCheck[] }) {
  if (checks.length === 0) return null;
  const open = checks.filter((c) => !c.accepted);
  return (
    <Tooltip
      maxWidth={360}
      content={
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
        </div>
      }
    >
      <span
        role="note"
        aria-label={`${open.length} check${open.length === 1 ? "" : "s"} to look at`}
        className={`text-caption inline-flex cursor-help items-center rounded-full px-1.5 font-semibold ${
          open.length > 0
            ? "bg-amber-100 text-amber-800"
            : "bg-surface-strong text-faint"
        }`}
      >
        {open.length > 0 ? `⚠ ${open.length}` : "✓"}
      </span>
    </Tooltip>
  );
}
