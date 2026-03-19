"use client";

import React from "react";
import { useScenario } from "@/lib/context/scenario-context";
import { confirm } from "@/components/ui/confirm-dialog";

/**
 * Wraps a value display and adds a visual indicator when the value
 * is overridden by the active scenario. Shows an amber dot and
 * applies a subtle amber tint.
 */
export function ScenarioValue({
  entity,
  recordId,
  field,
  children,
  className = "",
}: {
  entity: string;
  recordId: string | number;
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { isOverridden, isInScenario, clearOverride } = useScenario();
  const overridden = isInScenario && isOverridden(entity, recordId, field);

  if (!overridden) {
    return <span className={className}>{children}</span>;
  }

  return (
    <span className={`relative inline-flex items-center gap-0.5 ${className}`}>
      <span
        className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0 cursor-pointer"
        title="Overridden in this scenario — click to reset to main plan value"
        onClick={async (e) => {
          e.stopPropagation();
          if (await confirm("Reset this value to the main plan?")) {
            clearOverride(entity, recordId, field);
          }
        }}
      />
      <span className="text-amber-700">{children}</span>
    </span>
  );
}

/**
 * Shows a banner at the top of a page section when in scenario mode,
 * indicating that edits will be stored as scenario overrides.
 */
export function ScenarioBanner() {
  const { isInScenario, activeScenario } = useScenario();
  if (!isInScenario || !activeScenario) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-4 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
      <svg
        className="w-3.5 h-3.5 text-amber-600 flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      <span>
        Viewing <strong>{activeScenario.name}</strong> — any changes you make
        here only affect this scenario, not your main plan. Switch back to
        &quot;Main Plan&quot; to edit real data.
      </span>
    </div>
  );
}
