import { HelpTip } from "@/components/ui/help-tip";
import type { Dispatch, SetStateAction } from "react";

export type OverridesHeaderProps = {
  resetWizard: () => void;
  setShowWizard: Dispatch<SetStateAction<boolean>>;
  setWizardStep: Dispatch<SetStateAction<"year" | "type" | "fields">>;
  showWizard: boolean;
  totalCount: number;
};

export function OverridesHeader({
  resetWizard,
  setShowWizard,
  setWizardStep,
  showWizard,
  totalCount,
}: OverridesHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <h4 className="text-label text-muted font-semibold tracking-wider uppercase">
          Changes by year
        </h4>
        <HelpTip text="Change contributions, withdrawals, salary, budget, or add lump sums at specific future years. Changes carry forward until the next change." />
        {totalCount > 0 && (
          <span className="text-caption text-faint">{totalCount} active</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          if (showWizard) {
            resetWizard();
          } else {
            setShowWizard(true);
            setWizardStep("year");
          }
        }}
        className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
          showWizard
            ? "bg-surface-strong text-muted hover:text-primary"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {showWizard ? "Cancel" : "+ Add a change"}
      </button>
    </div>
  );
}

export type OverrideListProps = {
  allOverrides: {
    id: string;
    year: number;
    phase: "pre" | "post" | "life";
    type: string;
    summary: string;
    color: string;
    onDelete: () => void;
    onEdit?: () => void;
  }[];
};

export function OverrideList({ allOverrides }: OverrideListProps) {
  return (
    <>
      {allOverrides.length > 0 && (
        <div className="space-y-1">
          {allOverrides.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between rounded px-3 py-1.5 text-xs ${
                item.color === "emerald"
                  ? "bg-emerald-50 text-emerald-800"
                  : item.color === "amber"
                    ? "bg-amber-50 text-amber-800"
                    : item.color === "blue"
                      ? "bg-blue-50 text-blue-800"
                      : "bg-indigo-50 text-indigo-800"
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-semibold">{item.year}</span>
                <span
                  className={`text-micro shrink-0 rounded px-1.5 py-0.5 font-medium ${
                    item.color === "emerald"
                      ? "bg-emerald-100 text-emerald-700"
                      : item.color === "amber"
                        ? "bg-amber-100 text-amber-700"
                        : item.color === "blue"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-indigo-100 text-indigo-700"
                  }`}
                >
                  {item.type}
                </span>
                <span className="truncate">{item.summary}</span>
              </div>
              <span className="ml-2 flex shrink-0 items-center gap-1">
                {item.onEdit && (
                  <button
                    type="button"
                    className="text-muted hover:text-primary"
                    onClick={item.onEdit}
                    aria-label="Edit"
                  >
                    &#9998;
                  </button>
                )}
                <button
                  type="button"
                  className="text-muted hover:text-red-500"
                  onClick={item.onDelete}
                  aria-label="Delete"
                >
                  ×
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
