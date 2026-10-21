"use client";

import type { ReactNode } from "react";

/**
 * A page section that opens and closes from a full-width header bar —
 * "▶ Title  (count)        Click to expand". The open state belongs to the
 * caller, so a deep link can open it. The body sits in a card joined to
 * the bar. Used by Portfolio's Snapshot History, Account & Contribution
 * Settings and Holding history.
 */
export function CollapsibleSection({
  title,
  meta,
  help,
  open,
  onToggle,
  children,
  className = "",
}: {
  title: string;
  /** Small text after the title, e.g. "(327 snapshots)". */
  meta?: ReactNode;
  /** A HelpTip (or similar) after the title. */
  help?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* The whole bar toggles; the title is the keyboard/screen-reader
          button, and the help icon (its own button) sits outside it. */}
      <div
        onClick={onToggle}
        className={`bg-surface-primary hover:bg-surface-sunken flex w-full cursor-pointer items-center justify-between border px-5 py-3 shadow-sm transition-colors ${open ? "rounded-t-lg" : "rounded-lg"}`}
      >
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            className="flex items-center gap-2"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`text-faint h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
            >
              <path d="M5 3l7 5-7 5z" />
            </svg>
            <span className="text-primary font-semibold">{title}</span>
          </button>
          {help && <span onClick={(e) => e.stopPropagation()}>{help}</span>}
          {meta && <span className="text-faint text-xs">{meta}</span>}
        </span>
        <span className="text-faint text-xs" aria-hidden="true">
          {open ? "Click to collapse" : "Click to expand"}
        </span>
      </div>
      {open && (
        <div className="bg-surface-primary border-default rounded-b-lg border border-t-0 p-3 shadow-sm sm:p-4">
          {children}
        </div>
      )}
    </div>
  );
}
