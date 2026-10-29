"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

/**
 * A collapsible block of explanatory prose — Help and the methodology /
 * validation write-ups. Closed unless `defaultOpen`; the open state is its
 * own (unlike CollapsibleSection, whose page sections the caller opens).
 */
export function ProseSection({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-default overflow-hidden rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="bg-surface-sunken text-secondary hover:bg-surface-elevated flex w-full items-center gap-3 px-4 py-3 text-sm font-medium transition-colors"
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-blue-500" />}
        <span className="flex-1 text-left">{title}</span>
        <ChevronRight
          className={`text-faint h-4 w-4 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="text-muted space-y-4 px-4 py-4 text-sm leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
