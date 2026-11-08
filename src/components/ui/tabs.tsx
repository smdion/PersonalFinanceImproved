"use client";

import type { ReactNode } from "react";
import { moveChoice, rovingTabIndex } from "./arrow-keys";

/**
 * Each look is the class set of one tab strip in the app. `list` is the
 * strip's own element; a tab's classes are `tab` plus `on` or `off`.
 */
const LOOKS = {
  /** Profiles page: Budget, Salary, Contributions, … */
  "underline-xs": {
    list: "flex gap-1 overflow-x-auto",
    tab: "border-b-2 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors",
    on: "border-blue-600 text-blue-600",
    off: "text-muted hover:text-secondary border-transparent",
  },
  /** Settings page sections. */
  "underline-nav": {
    list: "flex gap-1 overflow-x-auto",
    tab: "border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
    on: "border-blue-600 text-blue-600",
    off: "text-muted hover:text-secondary hover:border-strong border-transparent",
  },
  /** Savings: Plan / Manage. */
  "underline-lg": {
    list: "border-subtle flex border-b",
    tab: "-mb-px border-b-2 px-5 py-2.5 text-sm font-medium transition-colors",
    on: "border-blue-600 text-blue-600",
    off: "text-muted hover:text-primary border-transparent",
  },
  /** Savings plan: Allocations, Transactions, Paychecks & Growth. */
  "underline-sm": {
    list: "flex",
    tab: "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
    on: "border-blue-600 text-blue-600",
    off: "text-muted hover:text-primary border-transparent",
  },
  /** Contribution profiles: Profiles / Compare. */
  "underline-compact": {
    list: "flex gap-1",
    tab: "border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
    on: "border-blue-600 text-blue-600",
    off: "text-muted hover:text-secondary border-transparent",
  },
  /** Tax buckets: Now / At Retirement. */
  "underline-neutral": {
    list: "flex gap-1",
    tab: "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
    on: "border-primary text-primary",
    off: "text-muted hover:text-primary border-transparent",
  },
  /** Tax optimization: the explorer and the comparison. */
  folder: {
    list: "flex gap-1 border-b px-3 pt-2",
    tab: "rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors",
    on: "bg-surface-primary text-primary border border-b-0",
    off: "text-muted hover:text-secondary",
  },
  /** The scenario bar's view mode. */
  tray: {
    list: "bg-surface-elevated flex rounded-md p-0.5",
    tab: "text-label rounded px-2.5 py-1.5 transition-colors",
    on: "bg-surface-primary text-primary shadow-sm",
    off: "text-muted hover:text-secondary",
  },
  /** The tax-data editors' years. */
  chip: {
    list: "flex gap-1",
    tab: "rounded-full px-3 py-1 text-sm transition-colors",
    on: "bg-blue-600 text-white",
    off: "bg-surface-elevated text-muted hover:bg-surface-strong",
  },
} as const;

export type TabsLook = keyof typeof LOOKS;

/** The classes a look gives its strip and a tab; tests compare them. */
export function tabsClasses(look: TabsLook, selected: boolean) {
  const l = LOOKS[look];
  return { list: l.list, tab: `${l.tab} ${selected ? l.on : l.off}` };
}

const tabId = (id: string, value: string | number) => `${id}-tab-${value}`;
const panelId = (id: string) => `${id}-panel`;

/**
 * Props for the element that holds the chosen tab's content, when the page
 * has one such element: it becomes the strip's `tabpanel`.
 */
export function tabPanelProps(id: string, value: string | number) {
  return {
    role: "tabpanel",
    id: panelId(id),
    "aria-labelledby": tabId(id, value),
  } as const;
}

/**
 * A strip of tabs: one is chosen; arrow keys, Home and End move the choice,
 * and Tab reaches only the chosen tab. Give `id` when the content sits in
 * one element that takes `tabPanelProps(id, value)`.
 */
export function Tabs<T extends string | number>({
  look,
  value,
  onChange,
  tabs,
  ariaLabel,
  ariaLabelledBy,
  id,
}: {
  look: TabsLook;
  value: T;
  onChange: (value: T) => void;
  tabs: readonly { value: T; label: ReactNode; title?: string }[];
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
}) {
  const values = tabs.map((t) => t.value);
  const chosen = values.indexOf(value);
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={LOOKS[look].list}
    >
      {tabs.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={id === undefined ? undefined : tabId(id, t.value)}
            aria-selected={selected}
            aria-controls={
              id !== undefined && selected ? panelId(id) : undefined
            }
            tabIndex={rovingTabIndex(chosen, i)}
            title={t.title}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) =>
              moveChoice(e, values, i, onChange, { vertical: false })
            }
            className={tabsClasses(look, selected).tab}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
