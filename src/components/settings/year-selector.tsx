"use client";

import { Tabs } from "@/components/ui/tabs";

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
      <Tabs
        look="chip"
        ariaLabel={ariaLabel}
        value={activeYear}
        onChange={onSelectYear}
        tabs={years.map((year) => ({
          value: year,
          label: (
            <>
              {year}
              {coverage?.[year] && (
                <span
                  className={
                    year === activeYear ? "text-blue-100" : "text-faint"
                  }
                >
                  {" "}
                  · {coverage[year]}
                </span>
              )}
            </>
          ),
        }))}
      />
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
