"use client";

import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
import type { LoanHistoryEntry } from "./types";

export function RefinanceHistory({
  loanHistory,
}: {
  loanHistory: LoanHistoryEntry[];
}) {
  return (
    <Card title="Refinance History">
      <div className="space-y-2">
        {loanHistory.map((h) => (
          <div key={h.name} className="flex items-center gap-3 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${h.isActive ? "bg-green-500" : "bg-gray-300"}`}
            />
            <span className={h.isActive ? "font-medium" : "text-muted"}>
              {h.name}
            </span>
            {h.paidOffDate && (
              <span className="text-xs text-faint">
                ended {formatDate(h.paidOffDate, "short")}
              </span>
            )}
            {h.refinancedInto && (
              <span className="text-faint">-&gt; {h.refinancedInto}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
