import { useState } from "react";
import { formatCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import { SegmentedControl } from "@/components/ui/segmented-control";

type YearlyGrowthEntry = { type: "pct" | "dollar"; value: number };
export type YearlyGrowth = Record<number, YearlyGrowthEntry>;
const GROWTH_TYPES = [
  { value: "pct", label: "%" },
  { value: "dollar", label: "$" },
] as const;

export function projectedNetPay(
  baseNetPay: number,
  year: number,
  baseYear: number,
  yearlyGrowth: YearlyGrowth,
): number {
  let pay = baseNetPay;
  for (let y = baseYear + 1; y <= year; y++) {
    const e = yearlyGrowth[y];
    if (!e || e.value === 0) continue;
    pay = e.type === "pct" ? pay * (1 + e.value / 100) : pay + e.value;
  }
  return pay;
}

function PaycheckGrowthEditor({
  projectionYears,
  baseNetPay,
  baseYear,
  yearlyGrowth,
  setYearlyGrowth,
}: {
  projectionYears: number;
  baseNetPay: number;
  baseYear: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}) {
  const years: number[] = [];
  for (let i = 1; i <= projectionYears; i++) years.push(baseYear + i);
  if (years.length === 0) return null;

  const updateEntry = (yr: number, patch: Partial<YearlyGrowthEntry>) => {
    const current = yearlyGrowth[yr] ?? { type: "pct", value: 0 };
    setYearlyGrowth({ ...yearlyGrowth, [yr]: { ...current, ...patch } });
  };
  const removeEntry = (yr: number) => {
    const next = { ...yearlyGrowth };
    delete next[yr];
    setYearlyGrowth(next);
  };
  const applyToAll = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) next[yr] = { ...entry };
    setYearlyGrowth(next);
  };

  return (
    <div className="bg-surface-elevated/40 space-y-1.5 rounded border p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-caption text-faint font-medium tracking-wide uppercase">
          Net Pay Annual Growth
        </span>
        {Object.keys(yearlyGrowth).length === 0 && (
          <button
            onClick={() => applyToAll({ type: "pct", value: 3 })}
            className="text-caption text-blue-600 hover:text-blue-700"
          >
            Set 3% for all
          </button>
        )}
      </div>
      {years.map((yr) => {
        const entry = yearlyGrowth[yr];
        const hasEntry = entry !== undefined && entry.value !== 0;
        const projected = projectedNetPay(
          baseNetPay,
          yr,
          baseYear,
          yearlyGrowth,
        );
        return (
          <div key={yr} className="flex items-center gap-2">
            <span className="text-faint w-10 shrink-0">{yr}</span>
            <SegmentedControl
              look="tray-strong"
              ariaLabel={`${yr} growth in`}
              reselect
              value={entry?.type === "dollar" ? "dollar" : "pct"}
              onChange={(type) => updateEntry(yr, { type })}
              options={GROWTH_TYPES}
            />
            <div className="flex items-center gap-0.5">
              {entry?.type === "dollar" && (
                <span className="text-caption text-muted">+$</span>
              )}
              <input
                type="number"
                min="0"
                step={entry?.type === "dollar" ? "50" : "0.5"}
                value={entry?.value ?? ""}
                placeholder="0"
                onChange={(e) => {
                  const val =
                    e.target.value === "" ? 0 : Number(e.target.value);
                  updateEntry(yr, { value: val });
                }}
                className="bg-surface-primary text-primary w-16 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums"
              />
              {(!entry || entry.type === "pct") && (
                <span className="text-caption text-muted">%</span>
              )}
              {entry?.type === "dollar" && (
                <span className="text-caption text-muted">/check</span>
              )}
            </div>
            <span className="text-caption text-muted tabular-nums">
              &rarr; {formatCurrency(projected)}/check
            </span>
            {hasEntry && (
              <button
                onClick={() => removeEntry(yr)}
                className="text-caption text-muted hover:text-faint"
                title="Remove growth for this year"
              >
                &times;
              </button>
            )}
          </div>
        );
      })}
      {years.length > 1 && Object.keys(yearlyGrowth).length > 0 && (
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={() => {
              const first = yearlyGrowth[years[0]!];
              if (first) applyToAll(first);
            }}
            className="text-caption text-muted hover:text-faint"
          >
            Apply first to all
          </button>
          <button
            onClick={() => setYearlyGrowth({})}
            className="text-caption text-muted hover:text-red-600"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

export function SimpleGrowthEditor({
  projectionYears,
  baseNetPay,
  baseYear,
  yearlyGrowth,
  setYearlyGrowth,
}: {
  projectionYears: number;
  baseNetPay: number;
  baseYear: number;
  yearlyGrowth: YearlyGrowth;
  setYearlyGrowth: (g: YearlyGrowth) => void;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const years: number[] = [];
  for (let i = 1; i <= projectionYears; i++) years.push(baseYear + i);

  const nonZeroEntries = years
    .map((y) => yearlyGrowth[y])
    .filter((e): e is YearlyGrowthEntry => e !== undefined && e.value !== 0);
  const isUniform =
    nonZeroEntries.length === 0 ||
    nonZeroEntries.every(
      (e) =>
        e.type === nonZeroEntries[0]!.type &&
        e.value === nonZeroEntries[0]!.value,
    );
  const uniformEntry: YearlyGrowthEntry = nonZeroEntries[0] ?? {
    type: "pct",
    value: 0,
  };

  const applyUniform = (entry: YearlyGrowthEntry) => {
    const next: YearlyGrowth = {};
    for (const yr of years) {
      if (entry.value !== 0) next[yr] = { ...entry };
    }
    setYearlyGrowth(next);
  };

  if (years.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-faint text-xs">Annual raise</span>
        {!isUniform ? (
          <span className="text-caption text-muted italic">custom by year</span>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={0.5}
              value={uniformEntry.value || ""}
              placeholder="0"
              onChange={(e) => {
                const val = e.target.value === "" ? 0 : Number(e.target.value);
                applyUniform({ type: "pct", value: val });
              }}
              className="bg-surface-primary text-primary w-14 rounded border px-1.5 py-0.5 text-right text-xs tabular-nums"
            />
            <span className="text-caption text-muted">% / yr</span>
          </div>
        )}
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="text-caption text-blue-600 hover:text-blue-700"
        >
          {showDetail ? "hide detail" : isUniform ? "set by year" : "edit"}
        </button>
      </div>
      {showDetail && (
        <PaycheckGrowthEditor
          projectionYears={projectionYears}
          baseNetPay={baseNetPay}
          baseYear={baseYear}
          yearlyGrowth={yearlyGrowth}
          setYearlyGrowth={setYearlyGrowth}
        />
      )}
    </div>
  );
}

export function fmt(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES_SHORT[parseInt(m!) - 1]} ${y}`;
}
