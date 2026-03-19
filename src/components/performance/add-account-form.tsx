"use client";

import React, { useState } from "react";
import { accountDisplayName } from "@/lib/utils/format";
import { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";
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
    if (parentCategory === "Portfolio") return true;
    return accountTypeToPerformanceCategory(ma.accountType) === parentCategory;
  });
  const [selectedId, setSelectedId] = useState<string>("");
  const [beginningBalance, setBeginningBalance] = useState("0");
  const [endingBalance, setEndingBalance] = useState("0");

  return (
    <div className="bg-surface-primary border rounded p-3 mt-1">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <label className="block">
          <span className="text-xs text-muted">Account</span>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          <span className="text-xs text-muted">Beginning Balance</span>
          <input
            type="text"
            value={beginningBalance}
            onChange={(e) => setBeginningBalance(e.target.value)}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Ending Balance</span>
          <input
            type="text"
            value={endingBalance}
            onChange={(e) => setEndingBalance(e.target.value)}
            className="mt-1 block w-full text-sm border border-strong rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </label>
      </div>
      <div className="flex gap-2 mt-2">
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
            });
          }}
          disabled={isSaving || !selectedId}
          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? "Saving..." : "Add"}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 text-xs text-muted hover:text-primary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
