"use client";

/** Settings bar for the spreadsheet view: year selectors + display toggles. */

type Props = {
  availableYears: number[];
  yearA: number;
  yearB: number;
  onYearAChange: (year: number) => void;
  onYearBChange: (year: number) => void;
  useMarketValue: boolean;
  onToggleMarketValue: () => void;
  useSalaryAverage: boolean;
  onToggleSalaryAverage: () => void;
};

export function SpreadsheetControls({
  availableYears,
  yearA,
  yearB,
  onYearAChange,
  onYearBChange,
  useMarketValue,
  onToggleMarketValue,
  useSalaryAverage,
  onToggleSalaryAverage,
}: Props) {
  const sorted = [...availableYears].sort((a, b) => b - a);

  return (
    <div className="bg-surface-elevated rounded-lg border p-3 mb-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {/* Year selectors */}
        <div className="flex items-center gap-2">
          <label className="text-muted font-medium whitespace-nowrap">
            Year to Compare
          </label>
          <select
            value={yearA}
            onChange={(e) => onYearAChange(Number(e.target.value))}
            className="rounded border bg-surface-primary px-2 py-1 text-sm"
          >
            {sorted.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <select
            value={yearB}
            onChange={(e) => onYearBChange(Number(e.target.value))}
            className="rounded border bg-surface-primary px-2 py-1 text-sm"
          >
            {sorted.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {/* Toggles */}
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={useMarketValue}
            onChange={onToggleMarketValue}
            className="rounded border-default"
          />
          <span className="text-muted whitespace-nowrap">
            Include Home Estimated Growth
          </span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={useSalaryAverage}
            onChange={onToggleSalaryAverage}
            className="rounded border-default"
          />
          <span className="text-muted whitespace-nowrap">
            Average Past 3 Years Salary for Stats
          </span>
        </label>
      </div>
    </div>
  );
}
