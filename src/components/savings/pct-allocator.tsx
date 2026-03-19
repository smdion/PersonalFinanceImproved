"use client";

import React, { useState } from "react";
import { formatCurrency } from "@/lib/utils/format";

export function PctAllocator({
  goals,
  defaultPool,
  onApply,
}: {
  goals: { goalId: number; name: string; monthlyAllocation: number }[];
  defaultPool: number;
  onApply: (allocations: { goalId: number; amount: number }[]) => void;
}) {
  const [pool, setPool] = useState(String(Math.round(defaultPool)));
  const [pcts, setPcts] = useState<Record<string, string>>(() => {
    const total = goals.reduce((s, g) => s + g.monthlyAllocation, 0);
    const result: Record<string, string> = {};
    for (const g of goals) {
      result[g.name] =
        total > 0
          ? String(Math.round((g.monthlyAllocation / total) * 100))
          : "0";
    }
    return result;
  });

  const poolNum = parseFloat(pool) || 0;
  const totalPct = Object.values(pcts).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">Total Pool:</label>
        <input
          type="number"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          className="w-24 border rounded px-2 py-0.5 text-xs"
        />
        <span className="text-xs text-faint">/mo</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {goals.map((g) => {
          const pct = parseFloat(pcts[g.name] ?? "0") || 0;
          const amount = (poolNum * pct) / 100;
          return (
            <div key={g.name} className="flex items-center gap-1.5">
              <span className="text-xs text-secondary truncate flex-1">
                {g.name}
              </span>
              <input
                type="number"
                value={pcts[g.name] ?? "0"}
                onChange={(e) => setPcts({ ...pcts, [g.name]: e.target.value })}
                className="w-12 border rounded px-1 py-0.5 text-xs text-right"
                min="0"
                max="100"
              />
              <span className="text-[10px] text-faint">%</span>
              <span className="text-[10px] text-muted w-14 text-right">
                {formatCurrency(amount)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${Math.abs(totalPct - 100) < 0.01 ? "text-green-600" : "text-red-500"}`}
        >
          Total: {totalPct.toFixed(0)}%
          {Math.abs(totalPct - 100) >= 0.01 &&
            ` (${totalPct > 100 ? "over" : "under"} by ${Math.abs(totalPct - 100).toFixed(0)}%)`}
        </span>
        <button
          onClick={() => {
            const allocations = goals.map((g) => ({
              goalId: g.goalId,
              amount: (poolNum * (parseFloat(pcts[g.name] ?? "0") || 0)) / 100,
            }));
            onApply(allocations);
          }}
          disabled={Math.abs(totalPct - 100) >= 0.01}
          className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
        >
          Apply Allocations
        </button>
      </div>
    </div>
  );
}
