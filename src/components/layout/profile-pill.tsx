"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useClickOutside } from "@/lib/hooks/use-click-outside";

export type ProfileOption = {
  id: string | number;
  name: string;
  /** Drives the highlight + the closed pill's label — the effectively-in-effect profile. */
  isActive: boolean;
  /** Right-aligned status text, e.g. "Active" or "Active (global)".
   *  "Active (global)" marks the household's default profile when a Plan has
   *  made a different one active, so the two don't both just read "Active". */
  badge?: string;
};

type ProfilePillProps = {
  label: string;
  options: ProfileOption[];
  onActivate: (id: string | number) => void;
  isPending?: boolean;
};

export function ProfilePill({
  label,
  options,
  onActivate,
  isPending,
}: ProfilePillProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));

  const active = options.find((o) => o.isActive);
  const activeName = active?.name ?? "None";

  return (
    <div className="flex items-center gap-2" ref={ref}>
      <span className="text-faint hidden sm:inline">{label}:</span>
      <div className="relative">
        <button
          onClick={() => setOpen(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={isPending}
          className="text-label bg-surface-primary text-primary flex items-center gap-1.5 rounded px-3 py-1.5 shadow-sm transition-colors disabled:opacity-50"
        >
          <span className="font-medium">{activeName}</span>
          <svg
            className="text-faint h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <div
            className="bg-surface-primary absolute top-full right-0 z-50 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border shadow-lg"
            role="listbox"
            aria-label={`${label} selection`}
          >
            {options.map((o) => (
              <button
                key={o.id}
                role="option"
                aria-selected={o.isActive}
                onClick={() => {
                  if (!o.isActive) onActivate(o.id);
                  setOpen(false);
                }}
                className={`hover:bg-surface-sunken flex w-full items-center gap-2 px-3 py-2 text-left first:rounded-t-lg last:rounded-b-lg ${
                  o.isActive ? "bg-blue-50 text-blue-700" : "text-secondary"
                }`}
              >
                <span className="truncate">{o.name}</span>
                {o.badge && (
                  <span className="ml-auto shrink-0">
                    <Badge color={o.badge.includes("global") ? "gray" : "blue"}>
                      {o.badge}
                    </Badge>
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && (
              <div className="text-muted px-3 py-2 text-xs">
                No profiles found
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
