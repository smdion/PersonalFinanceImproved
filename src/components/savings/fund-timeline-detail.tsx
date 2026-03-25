"use client";

import React from "react";
import { formatCurrency } from "@/lib/utils/format";
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
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />

      {/* Slide panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface-primary border-l z-50 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h2 className="text-sm font-semibold text-primary">
              {projection.name}
            </h2>
            <p className="text-xs text-muted">
              {formatCurrency(projection.current)} current
              {projection.target > 0 &&
                ` \u2022 ${formatCurrency(projection.target)} target`}
            </p>
            {canEdit !== false && (
              <p className="text-[10px] text-muted mt-0.5">
                Click &ldquo;Edit month&rdquo; to change allocations for all
                funds in that month
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-faint hover:text-secondary text-lg px-2"
            title="Close"
          >
            &times;
          </button>
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-3 top-0 bottom-0 w-px bg-surface-strong" />

            {monthDates.map((d, i) => {
              const balance = projection.balances[i]!;
              const allocation = projection.monthlyAllocations[i]!;
              const events = projection.monthEvents[i];
              const isOverride = projection.hasOverride[i];
              const isNegative = balance < 0;
              const isYearBoundary = d.getMonth() === 0 && i > 0;
              const isHighlighted = i === initialMonthIndex;

              const months = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec",
              ];
              const monthLabel = `${months[d.getMonth()]} ${d.getFullYear()}`;

              return (
                <div
                  key={monthKey(d)}
                  data-month-row
                  className={`relative pl-8 pb-4 ${isHighlighted ? "bg-blue-50 -mx-2 px-10 rounded-lg" : ""}`}
                >
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-1.5 top-1 w-3 h-3 rounded-full border-2 ${
                      events?.some((e) => e.amount < 0)
                        ? "bg-red-500 border-red-400"
                        : events?.some((e) => e.amount > 0)
                          ? "bg-green-500 border-green-400"
                          : "bg-surface-strong border-muted"
                    }`}
                  />

                  {/* Year separator */}
                  {isYearBoundary && (
                    <div className="text-[10px] text-muted font-semibold uppercase tracking-wider mb-1">
                      {d.getFullYear()}
                    </div>
                  )}

                  {/* Month header */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted font-medium">
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
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-[10px] tabular-nums ${
                        isOverride ? "text-blue-600 font-medium" : "text-muted"
                      }`}
                    >
                      +{formatCurrency(allocation)}/mo
                      {isOverride && " (override)"}
                    </span>
                    {canEdit !== false && (
                      <button
                        onClick={() => onEditMonth(d)}
                        className="text-[10px] text-blue-600 hover:text-blue-700 underline underline-offset-2"
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
                          className={`text-xs flex items-center gap-2 ${
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
