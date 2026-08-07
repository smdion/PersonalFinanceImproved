"use client";

/** Shared year-tab bar + "+ Year" trigger, used by the bracket/limit editors in settings. */

type YearSelectorProps = {
  years: number[];
  activeYear: number;
  onSelectYear: (year: number) => void;
  admin: boolean;
  ariaLabel: string;
  onAddYearClick: () => void;
};

export function YearSelector({
  years,
  activeYear,
  onSelectYear,
  admin,
  ariaLabel,
  onAddYearClick,
}: YearSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1" role="tablist" aria-label={ariaLabel}>
        {years.map((yr) => (
          <button
            key={yr}
            role="tab"
            aria-selected={yr === activeYear}
            onClick={() => onSelectYear(yr)}
            className={`px-3 py-1 text-sm rounded-full transition-colors ${
              yr === activeYear
                ? "bg-blue-600 text-white"
                : "bg-surface-elevated text-muted hover:bg-surface-strong"
            }`}
          >
            {yr}
          </button>
        ))}
      </div>
      {admin && (
        <button
          onClick={onAddYearClick}
          className="px-2 py-1 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 rounded-full hover:bg-blue-50 transition-colors"
        >
          + Year
        </button>
      )}
    </div>
  );
}
