"use client";

/** Shared year-tab bar + "+ Year" trigger, used by the bracket/limit editors in settings. */

type YearSelectorProps = {
  years: number[];
  activeYear: number;
  onSelectYear: (year: number) => void;
  admin: boolean;
  ariaLabel: string;
  onAddYearClick: () => void;
  /** Optional per-year "N/total" coverage label (e.g. Tax Data's shared
   *  toggle, where a year may exist in only some of the 5 underlying
   *  tables) — rendered next to the year when present for that year. */
  coverage?: Record<number, string>;
};

export function YearSelector({
  years,
  activeYear,
  onSelectYear,
  admin,
  ariaLabel,
  onAddYearClick,
  coverage,
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
            className={`rounded-full px-3 py-1 text-sm transition-colors ${
              yr === activeYear
                ? "bg-blue-600 text-white"
                : "bg-surface-elevated text-muted hover:bg-surface-strong"
            }`}
          >
            {yr}
            {coverage?.[yr] && (
              <span
                className={yr === activeYear ? "text-blue-100" : "text-faint"}
              >
                {" "}
                · {coverage[yr]}
              </span>
            )}
          </button>
        ))}
      </div>
      {admin && (
        <button
          onClick={onAddYearClick}
          className="rounded-full border border-blue-200 px-2 py-1 text-sm text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800"
        >
          + Year
        </button>
      )}
    </div>
  );
}
