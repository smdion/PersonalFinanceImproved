"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { formatCurrency, formatNumber } from "@/lib/utils/format";
import { HelpTip } from "@/components/ui/help-tip";

interface EfundData {
  trueBalance: number;
  monthsCovered: number | null;
  targetMonths: number;
  progress: number;
  neededAfterRepay: number;
}

export interface ReimbursementData {
  items: { amount: number; description: string }[];
  total: number;
  balance: number;
  target: number;
  categoryName: string;
}

export function EmergencyFundDetail({
  efund,
  budgetTierLabels,
  efundTierIndex,
  onTierChange,
  onTargetMonthsChange,
  reimbursements,
}: {
  efund: EfundData;
  budgetTierLabels: string[];
  efundTierIndex: number;
  onTierChange: (tier: number) => void;
  onTargetMonthsChange?: (months: number) => void;
  reimbursements?: ReimbursementData | null;
}) {
  const [showReimbursements, setShowReimbursements] = useState(false);

  return (
    <Card title="Emergency Fund Detail">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-faint text-xs mb-1">
            True Balance
            <HelpTip text="Current balance minus outstanding self-loans (money owed back to the fund)" />
          </p>
          <p className="text-lg font-semibold text-primary">
            {formatCurrency(efund.trueBalance)}
          </p>
        </div>
        <div>
          <p className="text-faint text-xs mb-1">Months Covered</p>
          <p className="text-lg font-semibold text-primary">
            {efund.monthsCovered !== null
              ? formatNumber(efund.monthsCovered, 1)
              : "N/A"}
          </p>
        </div>
        <div>
          <p className="text-faint text-xs mb-1">Target Months</p>
          {onTargetMonthsChange ? (
            <input
              type="number"
              min={1}
              max={24}
              className="w-16 text-lg font-semibold text-primary bg-transparent border-b focus:border-blue-500 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={efund.targetMonths}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (v >= 1 && v <= 24) onTargetMonthsChange(v);
              }}
            />
          ) : (
            <p className="text-lg font-semibold text-primary">
              {efund.targetMonths}
            </p>
          )}
        </div>
        <div>
          <p className="text-faint text-xs mb-1">
            Still Needed
            <HelpTip text="How much more you need to save to reach your target months of coverage" />
          </p>
          <p
            className={`text-lg font-semibold ${efund.neededAfterRepay <= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {efund.neededAfterRepay <= 0
              ? "Fully funded"
              : formatCurrency(efund.neededAfterRepay)}
          </p>
        </div>
      </div>

      {/* Pending Reimbursements */}
      {reimbursements && reimbursements.items.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <button
            onClick={() => setShowReimbursements(!showReimbursements)}
            className="flex items-center gap-2 text-xs text-muted hover:text-secondary"
          >
            <span className="text-[10px]">
              {showReimbursements ? "▾" : "▸"}
            </span>
            <span>Pending Reimbursements</span>
            <span className="text-amber-600 font-medium">
              {formatCurrency(reimbursements.total)}
            </span>
          </button>

          {showReimbursements && (
            <div className="mt-2 space-y-1.5 ml-4">
              {reimbursements.items.map((item) => (
                <div
                  key={item.description}
                  className="flex justify-between text-xs"
                >
                  <span className="text-secondary">{item.description}</span>
                  <span className="text-faint tabular-nums">
                    {formatCurrency(item.amount)}
                  </span>
                </div>
              ))}
              <div className="border-t pt-1.5 flex justify-between text-xs text-faint">
                <span>Counted as self-loan (added to with-repay balance)</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Budget tier selector for e-fund expenses */}
      {budgetTierLabels.length > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-faint">
          <span>Budget tier for essentials:</span>
          <select
            className="border border-strong bg-surface-primary rounded px-1.5 py-0.5 text-xs text-secondary"
            value={efundTierIndex}
            onChange={(e) => onTierChange(Number(e.target.value))}
          >
            {budgetTierLabels.map((label: string, i: number) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
    </Card>
  );
}
