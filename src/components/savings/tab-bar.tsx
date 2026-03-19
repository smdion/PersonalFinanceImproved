"use client";

import React from "react";
import { SavingsTab } from "./types";

export function TabBar({
  active,
  onChange,
}: {
  active: SavingsTab;
  onChange: (t: SavingsTab) => void;
}) {
  const tabs: { key: SavingsTab; label: string }[] = [
    { key: "projections", label: "Projections" },
    { key: "funds", label: "Fund Details" },
    { key: "transactions", label: "Transactions" },
  ];
  return (
    <div className="flex border-b mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            active === t.key
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-muted hover:text-secondary hover:border-strong"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
