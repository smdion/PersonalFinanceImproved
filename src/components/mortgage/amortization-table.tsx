"use client";

import { useRef, useEffect } from "react";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { AmortEntry } from "./types";

export function AmortizationTable({ schedule }: { schedule: AmortEntry[] }) {
  const todayRowRef = useRef<HTMLTableRowElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Find the row closest to today
  const now = new Date();
  const todayIdx = schedule.findIndex((entry) => new Date(entry.date) >= now);

  useEffect(() => {
    // Use requestAnimationFrame to ensure the DOM is fully painted before scrolling
    const raf = requestAnimationFrame(() => {
      if (todayRowRef.current) {
        todayRowRef.current.scrollIntoView({
          block: "center",
          behavior: "instant",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [todayIdx]);

  return (
    <div
      ref={containerRef}
      className="mt-3 overflow-x-auto max-h-80 overflow-y-auto"
    >
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-primary">
          <tr className="border-b">
            <th className="text-left py-1 pr-2 text-muted">#</th>
            <th className="text-left py-1 px-2 text-muted">Date</th>
            <th className="text-right py-1 px-2 text-muted">Payment</th>
            <th className="text-right py-1 px-2 text-muted">Principal</th>
            <th className="text-right py-1 px-2 text-muted">Interest</th>
            <th className="text-right py-1 px-2 text-muted">Extra</th>
            <th className="text-right py-1 pl-2 text-muted">Balance</th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((entry, i) => {
            const isToday = i === todayIdx;
            const isPast = i < todayIdx;
            return (
              <tr
                key={entry.month}
                ref={isToday ? todayRowRef : undefined}
                className={`border-b border-subtle ${
                  isToday
                    ? "bg-blue-100 font-semibold"
                    : isPast
                      ? "text-faint"
                      : ""
                }`}
              >
                <td className="py-1 pr-2">{entry.month}</td>
                <td className="py-1 px-2">
                  {formatDate(entry.date, "short")}
                  {isToday && (
                    <span className="ml-1 text-blue-600 text-[10px]">
                      TODAY
                    </span>
                  )}
                </td>
                <td className="text-right py-1 px-2">
                  {formatCurrency(entry.payment)}
                </td>
                <td className="text-right py-1 px-2">
                  {formatCurrency(entry.principal)}
                </td>
                <td className="text-right py-1 px-2 text-red-600">
                  {formatCurrency(entry.interest)}
                </td>
                <td className="text-right py-1 px-2 text-green-600">
                  {entry.extraPayment > 0
                    ? formatCurrency(entry.extraPayment)
                    : ""}
                </td>
                <td className="text-right py-1 pl-2 font-medium">
                  {formatCurrency(entry.balance)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
