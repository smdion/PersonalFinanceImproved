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
      className="mt-3 max-h-80 overflow-x-auto overflow-y-auto"
    >
      <table className="w-full text-xs">
        <thead className="bg-surface-primary sticky top-0">
          <tr className="border-b">
            <th className="text-muted py-1 pr-2 text-left">#</th>
            <th className="text-muted px-2 py-1 text-left">Date</th>
            <th className="text-muted px-2 py-1 text-right">Payment</th>
            <th className="text-muted px-2 py-1 text-right">Principal</th>
            <th className="text-muted px-2 py-1 text-right">Interest</th>
            <th className="text-muted px-2 py-1 text-right">Extra</th>
            <th className="text-muted py-1 pl-2 text-right">Balance</th>
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
                className={`border-subtle border-b print:break-inside-avoid ${
                  isToday
                    ? "bg-blue-100 font-semibold"
                    : isPast
                      ? "text-faint"
                      : ""
                }`}
              >
                <td className="py-1 pr-2">{entry.month}</td>
                <td className="px-2 py-1">
                  {formatDate(entry.date, "short")}
                  {isToday && (
                    <span className="text-caption ml-1 text-blue-600">
                      TODAY
                    </span>
                  )}
                </td>
                <td className="px-2 py-1 text-right">
                  {formatCurrency(entry.payment)}
                </td>
                <td className="px-2 py-1 text-right">
                  {formatCurrency(entry.principal)}
                </td>
                <td className="px-2 py-1 text-right text-red-600">
                  {formatCurrency(entry.interest)}
                </td>
                <td className="px-2 py-1 text-right text-green-600">
                  {entry.extraPayment > 0
                    ? formatCurrency(entry.extraPayment)
                    : ""}
                </td>
                <td className="py-1 pl-2 text-right font-medium">
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
