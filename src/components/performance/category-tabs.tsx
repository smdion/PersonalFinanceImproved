"use client";

import React from "react";
import { HelpTip } from "@/components/ui/help-tip";

const CATEGORY_HELP: Record<string, string> = {
  "401k/IRA": "401k, 403b, and IRA accounts",
  HSA: "Health Savings Accounts",
  Brokerage: "Taxable brokerage and ESPP accounts",
  Retirement:
    "All accounts with a retirement goal (401k/IRA + HSA + retirement brokerages)",
  Portfolio: "Grand total across all investment accounts",
};

function TabGroup({
  label,
  helpText,
  categories,
  activeCategory,
  onCategoryChange,
}: {
  label: string;
  helpText: string;
  categories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted uppercase tracking-wide font-medium inline-flex items-center gap-1">
        {label}
        <HelpTip text={helpText} />
      </span>
      <div className="flex gap-1 bg-surface-elevated rounded-lg p-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            title={CATEGORY_HELP[cat]}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              activeCategory === cat
                ? "bg-surface-primary text-primary shadow-sm font-medium"
                : "text-muted hover:text-primary"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CategoryTabs({
  accountTypeCategories,
  parentCategories,
  activeCategory,
  onCategoryChange,
}: {
  accountTypeCategories: string[];
  parentCategories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-6">
      <TabGroup
        label="By Account"
        helpText="Performance broken down by account type"
        categories={accountTypeCategories}
        activeCategory={activeCategory}
        onCategoryChange={onCategoryChange}
      />
      <TabGroup
        label="Rollup"
        helpText="Aggregated views across account types"
        categories={parentCategories}
        activeCategory={activeCategory}
        onCategoryChange={onCategoryChange}
      />
    </div>
  );
}
