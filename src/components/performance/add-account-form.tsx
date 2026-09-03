"use client";

import React, { useState } from "react";
import { accountDisplayName } from "@/lib/utils/format";
import { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";
import { isPortfolioParent } from "@/lib/config/account-types";
import type { AddAccountFormProps } from "./types";

export function AddAccountForm({
  year,
  parentCategory,
  masterAccounts,
  onSave,
  onCancel,
  isSaving,
}: AddAccountFormProps) {
  // Filter master accounts to the active category by account type group (or show all for Portfolio tab)
  const available = masterAccounts.filter((ma) => {
    if (isPortfolioParent(parentCategory)) return true;
    return accountTypeToPerformanceCategory(ma.accountType) === parentCategory;
  });
  const [selectedId, setSelectedId] = useState<string>("");
  const [beginningBalance, setBeginningBalance] = useState("0");
  const [endingBalance, setEndingBalance] = useState("0");

  return (
    <div className="bg-surface-primary mt-1 rounded border p-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <label className="block">
          <span className="text-muted text-xs">Account</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="border-strong mt-1 block w-full rounded border px-2 py-1.5 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
          >
            <option value="">Select account...</option>
            {available.map((ma) => (
              <option key={ma.id} value={String(ma.id)}>
                {accountDisplayName(ma)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-muted text-xs">Beginning Balance</span>
          <input
            type="text"
            value={beginningBalance}
            onChange={(e) => setBeginningBalance(e.target.value)}
            className="border-strong mt-1 block w-full rounded border px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-muted text-xs">Ending Balance</span>
          <input
            type="text"
            value={endingBalance}
            onChange={(e) => setEndingBalance(e.target.value)}
            className="border-strong mt-1 block w-full rounded border px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => {
            if (!selectedId) return;
            onSave({
              year,
              performanceAccountId: parseInt(selectedId, 10),
              beginningBalance,
              totalContributions: "0",
              yearlyGainLoss: "0",
              endingBalance,
              employerContributions: "0",
              fees: "0",
              distributions: "0",
              rollovers: "0",
            });
          }}
          disabled={isSaving || !selectedId}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="text-muted hover:text-primary px-3 py-1 text-xs transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
