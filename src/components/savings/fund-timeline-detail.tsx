"use client";

import React from "react";
import { formatCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import { GoalProjection, monthKey } from "./types";

interface FundTimelineDetailProps {
  projection: GoalProjection;
  monthDates: Date[];
  initialMonthIndex?: number;
  onClose: () => void;
  onEditMonth: (monthDate: Date) => void;
  canEdit?: boolean;
}

export function FundTimelineDetail({
  projection,
  monthDates,
  initialMonthIndex,
  onClose,
  onEditMonth,
  canEdit,
}: FundTimelineDetailProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (initialMonthIndex !== undefined && scrollRef.current) {
      const rows = scrollRef.current.querySelectorAll("[data-month-row]");
      rows[initialMonthIndex]?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }
  }, [initialMonthIndex]);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Slide panel */}
      <div className="bg-surface-primary fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-primary text-sm font-semibold">
              {projection.name}
            </h2>
            <p className="text-muted text-xs">
              {formatCurrency(projection.current)} current
              {projection.target > 0 &&
                ` \u2022 ${formatCurrency(projection.target)} target`}
            </p>
            {canEdit !== false && (
              <p className="text-caption text-muted mt-0.5">
                Click &ldquo;Edit month&rdquo; to change allocations for all
                funds in that month
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-faint hover:text-secondary px-2 text-lg"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          <div className="relative">
            {/* Vertical line */}
            <div className="bg-surface-strong absolute top-0 bottom-0 left-3 w-px" />

            {monthDates.map((d, i) => {
              const balance = projection.balances[i]!;
              const allocation = projection.monthlyAllocations[i]!;
              const events = projection.monthEvents[i];
              const isOverride = projection.hasOverride[i];
              const isNegative = balance < 0;
              const isYearBoundary = d.getMonth() === 0 && i > 0;
              const isHighlighted = i === initialMonthIndex;

              const monthLabel = `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getFullYear()}`;

              return (
                <div
                  key={monthKey(d)}
                  data-month-row
                  className={`relative pb-4 pl-8 ${isHighlighted ? "-mx-2 rounded-lg bg-blue-50 px-10" : ""}`}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute top-1 left-1.5 h-3 w-3 rounded-full border-2 ${
                      events?.some((e) => e.amount < 0)
                        ? "border-red-400 bg-red-500"
                        : events?.some((e) => e.amount > 0)
                          ? "border-green-400 bg-green-500"
                          : "bg-surface-strong border-muted"
                    }`}
                  />

                  {/* Year separator */}
                  {isYearBoundary && (
                    <div className="text-caption text-muted mb-1 font-semibold tracking-wider uppercase">
                      {d.getFullYear()}
                    </div>
                  )}

                  {/* Month header */}
                  <div className="flex items-center justify-between">
                    <span className="text-muted text-xs font-medium">
                      {monthLabel}
                    </span>
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        isNegative ? "text-red-600" : "text-primary"
                      }`}
                    >
                      {formatCurrency(balance)}
                    </span>
                  </div>

                  {/* Allocation — read-only with edit link */}
                  <div className="mt-0.5 flex items-center gap-2">
                    <span
                      className={`text-caption tabular-nums ${
                        isOverride ? "font-medium text-blue-600" : "text-muted"
                      }`}
                    >
                      +{formatCurrency(allocation)}/mo
                      {isOverride && " (override)"}
                    </span>
                    {canEdit !== false && (
                      <button
                        onClick={() => onEditMonth(d)}
                        className="text-caption text-blue-600 underline underline-offset-2 hover:text-blue-700"
                      >
                        Edit month
                      </button>
                    )}
                  </div>

                  {/* Events */}
                  {events && events.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {events.map((ev) => (
                        <div
                          key={ev.id}
                          className={`flex items-center gap-2 text-xs ${
                            ev.amount < 0 ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          <span className="font-medium tabular-nums">
                            {ev.amount >= 0 ? "+" : ""}
                            {formatCurrency(ev.amount)}
                          </span>
                          <span className="text-muted">{ev.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
