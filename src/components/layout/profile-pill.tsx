"use client";

import { useState, useRef, useEffect } from "react";

export type ProfileOption = {
  id: string | number;
  name: string;
  isActive: boolean;
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
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] bg-surface-primary text-primary shadow-sm transition-colors disabled:opacity-50"
        >
          <span className="font-medium">{activeName}</span>
          <svg
            className="w-3 h-3 text-faint"
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
            className="absolute top-full right-0 mt-1 w-56 max-w-[calc(100vw-2rem)] bg-surface-primary border rounded-lg shadow-lg z-50"
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
                className={`w-full text-left px-3 py-2 hover:bg-surface-sunken flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg ${
                  o.isActive ? "bg-blue-50 text-blue-700" : "text-secondary"
                }`}
              >
                <span className="truncate">{o.name}</span>
                {o.isActive && (
                  <span className="ml-auto text-[10px] text-blue-500 shrink-0">
                    Active
                  </span>
                )}
              </button>
            ))}
            {options.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted">
                No profiles found
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
