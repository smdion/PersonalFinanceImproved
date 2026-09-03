"use client";

import React from "react";
import { HelpTip } from "@/components/ui/help-tip";
import {
  PERF_CATEGORY_DEFAULT,
  PERF_CATEGORY_HSA,
  PERF_CATEGORY_BROKERAGE,
  PERF_CATEGORY_RETIREMENT,
  PERF_CATEGORY_PORTFOLIO,
} from "@/lib/config/display-labels";

export const CATEGORY_HELP: Record<string, string> = {
  [PERF_CATEGORY_DEFAULT]: "401k, 403b, and IRA accounts",
  [PERF_CATEGORY_HSA]: "Health Savings Accounts",
  [PERF_CATEGORY_BROKERAGE]: "Taxable brokerage and ESPP accounts",
  [PERF_CATEGORY_RETIREMENT]:
    "All accounts with a retirement goal (401k/IRA + HSA + retirement brokerages)",
  [PERF_CATEGORY_PORTFOLIO]: "Grand total across all investment accounts",
};

type TabGroupProps = {
  label: string;
  helpText: string;
  categories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
};

export function TabGroup({
  label,
  helpText,
  categories,
  activeCategory,
  onCategoryChange,
}: TabGroupProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
        {label}
        <HelpTip text={helpText} />
      </span>
      <div className="bg-surface-elevated flex gap-1 rounded-lg p-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            title={CATEGORY_HELP[cat]}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
              activeCategory === cat
                ? "bg-surface-primary text-primary font-medium shadow-sm"
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

type BasisToggleGroupProps = {
  showBasis: boolean;
  onToggleBasis: () => void;
  showUnrealized: boolean;
  onToggleUnrealized: () => void;
  onlyBasis: boolean;
  onToggleOnlyBasis: () => void;
};

/** Independent show/hide toggles for the basis columns (Cost Basis/
 *  Contribution Basis and Unrealized/Conversion Basis) — not a category
 *  filter like TabGroup (those change which accounts show; these change
 *  which columns show for the same accounts), so both can be on/off at
 *  once rather than exclusive. Hidden by default: most views don't need
 *  basis detail, and the columns add width to every row. "Only" is a third,
 *  independent toggle — it hides every OTHER column (Beginning through
 *  Return) so just Year + whichever of Basis/Unrealized are on show,
 *  without changing what Basis/Unrealized themselves are set to. */
export function BasisToggleGroup({
  showBasis,
  onToggleBasis,
  showUnrealized,
  onToggleUnrealized,
  onlyBasis,
  onToggleOnlyBasis,
}: BasisToggleGroupProps) {
  const toggleBtn = (pressed: boolean) =>
    `px-4 py-1.5 text-sm rounded-md transition-colors ${
      pressed
        ? "bg-surface-primary text-primary shadow-sm font-medium"
        : "text-muted hover:text-primary"
    }`;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase">
        Basis
        <HelpTip text="Show cost/Roth basis columns in the table below — hidden by default." />
      </span>
      <div className="bg-surface-elevated flex gap-1 rounded-lg p-1">
        <button
          onClick={onToggleBasis}
          aria-pressed={showBasis}
          title="Cost Basis / Contribution Basis / Conversion Basis"
          className={toggleBtn(showBasis)}
        >
          Basis
        </button>
        <button
          onClick={onToggleUnrealized}
          aria-pressed={showUnrealized}
          title="Unrealized gain (Brokerage only)"
          className={toggleBtn(showUnrealized)}
        >
          Unrealized
        </button>
        <button
          onClick={onToggleOnlyBasis}
          aria-pressed={onlyBasis}
          title="Hide every other column — show just Year and the basis columns"
          className={toggleBtn(onlyBasis)}
        >
          Only
        </button>
      </div>
    </div>
  );
}

type CategoryTabsProps = {
  accountTypeCategories: string[];
  parentCategories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
  showBasis: boolean;
  onToggleBasis: () => void;
  showUnrealized: boolean;
  onToggleUnrealized: () => void;
  onlyBasis: boolean;
  onToggleOnlyBasis: () => void;
};

export function CategoryTabs({
  accountTypeCategories,
  parentCategories,
  activeCategory,
  onCategoryChange,
  showBasis,
  onToggleBasis,
  showUnrealized,
  onToggleUnrealized,
  onlyBasis,
  onToggleOnlyBasis,
}: CategoryTabsProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-4">
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
      <BasisToggleGroup
        showBasis={showBasis}
        onToggleBasis={onToggleBasis}
        showUnrealized={showUnrealized}
        onToggleUnrealized={onToggleUnrealized}
        onlyBasis={onlyBasis}
        onToggleOnlyBasis={onToggleOnlyBasis}
      />
    </div>
  );
}
