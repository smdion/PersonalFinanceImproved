import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * A numbered card for one step of the workflow (Paycheck → Budget →
 * Savings). Gives the tab visual structure instead of one long
 * undifferentiated column — each step is its own bounded region with a
 * clear "what is this for" line, matching how a multi-step form reads.
 *
 * Collapsible rather than a wizard: the whole point of What-If is seeing
 * the cascade (a salary tweak in step 1 changes the leftover figure in
 * step 3) so hiding earlier steps behind "Next" would work against the
 * tool's purpose. Folding a step you're done with just reclaims vertical
 * space — `headerExtra` (each step's key figure) stays visible either way,
 * so a collapsed step still tells you what it resolved to.
 */
export function WhatIfStep({
  number,
  title,
  description,
  headerExtra,
  defaultExpanded = true,
  children,
}: {
  number: number;
  title: string;
  description?: string;
  /** Right-aligned content in the header row (mode tabs, leftover figure).
   *  Rendered outside the collapse toggle, so it stays visible — and its
   *  own controls (e.g. the mode picker) stay clickable — when folded. */
  headerExtra?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <section className="border-default bg-surface-sunken/40 rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-start gap-2.5 text-left"
          aria-expanded={expanded}
        >
          <span className="text-micro mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 font-semibold text-white">
            {number}
          </span>
          <div>
            <h3 className="text-primary flex items-center gap-1 text-sm leading-tight font-semibold">
              {title}
              {expanded ? (
                <ChevronDown className="text-faint h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="text-faint h-3.5 w-3.5" />
              )}
            </h3>
            {description && (
              <p className="text-caption text-faint mt-0.5">{description}</p>
            )}
          </div>
        </button>
        {headerExtra}
      </div>
      {expanded && children}
    </section>
  );
}
