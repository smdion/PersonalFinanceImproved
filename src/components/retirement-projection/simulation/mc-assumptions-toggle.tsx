import type { Dispatch, SetStateAction } from "react";

export type AssumptionsToggleProps = {
  activeOverrides: string[];
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
};

export function AssumptionsToggle({
  activeOverrides,
  expanded,
  setExpanded,
}: AssumptionsToggleProps) {
  return (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="text-muted hover:bg-surface-elevated flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors"
    >
      <span className="font-medium">
        Simulation Assumptions
        {activeOverrides.length > 0 && (
          <span className="ml-1 text-amber-600">
            ({activeOverrides.length} set by you)
          </span>
        )}
      </span>
      <svg
        aria-hidden="true"
        className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}
