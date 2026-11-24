/** The Retirement page's tabs: Projection, Strategy Comparison and Projection Health. */
import type { FocusStateValue } from "@/lib/config/focus-topics";

type RetirementPageTabsProps = {
  pageTab: FocusStateValue<"retirementTab">;
  setPageTab: (tab: FocusStateValue<"retirementTab">) => void;
  setComparisonExpanded: (expanded: boolean) => void;
};
export function RetirementPageTabs({
  pageTab,
  setPageTab,
  setComparisonExpanded,
}: RetirementPageTabsProps) {
  return (
    <div className="bg-surface-primary/60 mb-4 flex w-fit max-w-full flex-wrap rounded-md border p-0.5 print:hidden">
      <button
        type="button"
        onClick={() => setPageTab("projection")}
        className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          pageTab === "projection"
            ? "bg-surface-primary text-primary border shadow-sm"
            : "text-muted hover:text-secondary"
        }`}
      >
        Projection
      </button>
      <button
        type="button"
        aria-label="Strategy Comparison"
        onClick={() => {
          setPageTab("comparison");
          setComparisonExpanded(true);
        }}
        className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          pageTab === "comparison"
            ? "bg-surface-primary text-primary border shadow-sm"
            : "text-muted hover:text-secondary"
        }`}
      >
        <span aria-hidden="true" className="sm:hidden">
          Comparison
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          Strategy Comparison
        </span>
      </button>
      <button
        type="button"
        onClick={() => setPageTab("planHealth")}
        className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
          pageTab === "planHealth"
            ? "bg-surface-primary text-primary border shadow-sm"
            : "text-muted hover:text-secondary"
        }`}
      >
        Projection Health
      </button>
    </div>
  );
}
