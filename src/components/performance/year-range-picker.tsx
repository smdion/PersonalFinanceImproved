"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

export type YearRange = { start: number; end: number };

/**
 * Whole-year-only range picker for the Performance page's filtering feature.
 * No calendar widget / date library — deliberately simple since sub-annual
 * ranges aren't supported by the underlying data (see plan doc for why).
 */
export function YearRangePicker({
  minYear,
  maxYear,
  currentYear,
  value,
  onChange,
}: {
  minYear: number;
  maxYear: number;
  currentYear: number;
  /** null = "Since Inception" (today's default behavior) */
  value: YearRange | null;
  onChange: (range: YearRange | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [customStart, setCustomStart] = useState<number>(minYear);
  const [customEnd, setCustomEnd] = useState<number>(maxYear);

  const years = Array.from(
    { length: maxYear - minYear + 1 },
    (_, i) => minYear + i,
  );

  const isSinceInception = value === null;
  const isYtd =
    value !== null && value.start === currentYear && value.end === currentYear;

  const isLastN = (n: number) => {
    if (value === null) return false;
    const start = Math.max(currentYear - (n - 1), minYear);
    return value.start === start && value.end === currentYear;
  };

  const summaryLabel = isSinceInception
    ? "Since Inception"
    : isYtd
      ? "YTD"
      : isLastN(1)
        ? "Last 1 Year"
        : isLastN(3)
          ? "Last 3 Years"
          : isLastN(5)
            ? "Last 5 Years"
            : isLastN(10)
              ? "Last 10 Years"
              : `${value!.start}–${value!.end}`;

  const presetButton = (
    label: string,
    active: boolean,
    onClick: () => void,
  ) => (
    <button
      onClick={() => {
        onClick();
        setOpen(false);
      }}
      className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
        active
          ? "bg-blue-50 text-blue-700 font-medium"
          : "text-secondary hover:bg-blue-50"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        onClick={(e) => {
          setAnchorRect(e.currentTarget.getBoundingClientRect());
          setOpen(!open);
        }}
        className="px-2.5 py-1 text-label rounded border border-surface-strong bg-surface-elevated text-faint hover:text-primary hover:bg-surface-strong transition-colors"
        title="Choose the years to include"
      >
        {summaryLabel}
      </button>

      {open &&
        anchorRect &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
              role="presentation"
            />
            <div
              className="fixed z-50 bg-surface-primary border rounded-lg shadow-lg p-2 w-56"
              style={{
                top: anchorRect.bottom + 4,
                left: Math.min(anchorRect.left, window.innerWidth - 240),
              }}
            >
              {presetButton("Since Inception", isSinceInception, () =>
                onChange(null),
              )}
              {presetButton("YTD", isYtd, () =>
                onChange({ start: currentYear, end: currentYear }),
              )}
              {[1, 3, 5, 10].map((n) =>
                presetButton(
                  `Last ${n} Year${n !== 1 ? "s" : ""}`,
                  isLastN(n),
                  () =>
                    onChange({
                      start: Math.max(currentYear - (n - 1), minYear),
                      end: currentYear,
                    }),
                ),
              )}

              <div className="border-t border-subtle mt-1 pt-2">
                <span className="text-caption text-muted px-2">
                  Custom range
                </span>
                <div className="flex items-center gap-1 px-2 py-1">
                  <select
                    value={customStart}
                    onChange={(e) => setCustomStart(Number(e.target.value))}
                    className="text-xs border rounded px-1 py-0.5 flex-1"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <span className="text-faint text-xs">–</span>
                  <select
                    value={customEnd}
                    onChange={(e) => setCustomEnd(Number(e.target.value))}
                    className="text-xs border rounded px-1 py-0.5 flex-1"
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    const start = Math.min(customStart, customEnd);
                    const end = Math.max(customStart, customEnd);
                    onChange({ start, end });
                    setOpen(false);
                  }}
                  className="w-full text-center px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors mt-1"
                >
                  Apply
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
