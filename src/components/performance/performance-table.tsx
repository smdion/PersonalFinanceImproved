"use client";

import React from "react";
import { Lock, LockOpen } from "lucide-react";
import { HelpTip } from "@/components/ui/help-tip";
import { YearRow } from "./year-row";
import type {
  AnnualRow,
  AccountRow,
  MasterAccount,
  EditingCell,
} from "./types";
import {
  accountTypeToPerformanceCategory,
  PERF_CATEGORY_PORTFOLIO,
  PERF_CATEGORY_RETIREMENT,
} from "@/lib/config/display-labels";
import { isRetirementParent } from "@/lib/config/account-types";

type PerformanceTableProps = {
  filtered: AnnualRow[];
  accountRows: AccountRow[];
  masterAccounts: MasterAccount[];
  activeCategory: string;
  expandedYears: Set<number>;
  onToggleYear: (year: number) => void;
  editingCell: EditingCell;
  editValue: string;
  onStartEdit: (
    type: "annual" | "account" | "master" | "basis",
    id: number,
    field: string,
    currentValue: number,
  ) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  canEdit?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  showBasis: boolean;
  showUnrealized: boolean;
  onlyBasis: boolean;
};

export function PerformanceTable({
  filtered,
  accountRows,
  masterAccounts,
  activeCategory,
  expandedYears,
  onToggleYear,
  editingCell,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
  canEdit,
  locked,
  onToggleLock,
  showBasis,
  showUnrealized,
  onlyBasis,
}: PerformanceTableProps) {
  const years = Array.from(new Set(filtered.map((r) => r.year))).sort(
    (a, b) => b - a,
  );

  return (
    <div className="bg-surface-primary overflow-x-auto rounded-lg border shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-sunken border-b">
            <th className="text-muted px-4 py-3 text-left font-medium whitespace-nowrap">
              Year
            </th>
            {!onlyBasis && (
              <>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Beginning
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Total Contributions
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Employer Match
                  <HelpTip text="Employer contributions matched during the year. For ESPP accounts this is the purchase discount — not a cash contribution, but tracked here for consistency." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Distributions
                  <HelpTip text="Withdrawals or money taken out of accounts during the year. For ESPP this includes dividends kept in the ESPP account rather than wired out." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Rollovers
                  <HelpTip text="Internal transfers between accounts. Positive = money rolled in, negative = money rolled out. For ESPP, negative rollovers are share sale proceeds wired to the brokerage. Should net to zero at Portfolio level." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Fees
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Gain/Loss
                  <HelpTip text="Change in value after contributions, distributions, and fees. For ESPP accounts, this measures against the full market value at purchase — since shares are bought at a discount, your loss relative to what you actually paid is smaller than this figure alone shows." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Ending
                  <HelpTip text="Balance based on tracked performance data. For in-progress years this may lag behind the Portfolio Value (which uses the latest snapshot)." />
                </th>
              </>
            )}
            {showBasis && (
              <>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Cost Basis
                  <HelpTip text="Cumulative contributions — your original invested dollars. Only gains above basis are taxable on withdrawal. Blank for accounts that don't track cost basis (Retirement, HSA)." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Contribution Basis
                  <HelpTip text="Roth contribution/rollover basis, per (account, owner, year) — always penalty-free and tax-free. Blank for accounts that don't track Roth basis (HSA, brokerage). Edit on the current year to update Tax Buckets too — same underlying figure." />
                </th>
                <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                  Conversion Basis
                  <HelpTip text="Roth conversion basis — tax-free, but penalty-free only once its own 5-year clock has passed. See Tax Buckets for the accessible-now/locked split." />
                </th>
              </>
            )}
            {showUnrealized && (
              <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
                Unrealized
                <HelpTip text="Ending balance minus cost basis — the portion subject to capital gains tax if sold." />
              </th>
            )}
            <th className="text-muted px-4 py-3 text-right font-medium whitespace-nowrap">
              <span className="inline-flex items-center justify-end gap-1">
                {!onlyBasis && (
                  <>
                    Return
                    <HelpTip text="Annual rate of return calculated from gains relative to average invested balance" />
                  </>
                )}
                {onToggleLock && (
                  <button
                    onClick={onToggleLock}
                    className="text-faint hover:text-primary ml-1 transition-colors"
                    title={locked ? "Unlock to edit" : "Lock editing"}
                  >
                    {locked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <LockOpen className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const row = filtered.find((r) => r.year === year);
            if (!row) return null;
            const isExpanded = expandedYears.has(year);
            const yearAccountsAll = accountRows
              .filter((a) => {
                if (a.year !== year) return false;
                if (activeCategory === PERF_CATEGORY_PORTFOLIO) return true;
                if (activeCategory === PERF_CATEGORY_RETIREMENT)
                  return isRetirementParent(a.parentCategory);
                return (
                  accountTypeToPerformanceCategory(a.accountType) ===
                  activeCategory
                );
              })
              .sort(
                (a, b) =>
                  a.displayOrder - b.displayOrder ||
                  a.institution.localeCompare(b.institution),
              );
            // Sort active accounts first, inactive after
            const activeAccts = yearAccountsAll.filter((a) => {
              const master = masterAccounts?.find(
                (m) => m.id === a.performanceAccountId,
              );
              return master ? master.isActive : true;
            });
            const inactiveAccts = yearAccountsAll.filter((a) => {
              const master = masterAccounts?.find(
                (m) => m.id === a.performanceAccountId,
              );
              return master ? !master.isActive : false;
            });
            const yearAccounts = [...activeAccts, ...inactiveAccts];

            return (
              <YearRow
                key={year}
                row={row}
                accounts={yearAccounts}
                activeAccountCount={activeAccts.length}
                isExpanded={isExpanded}
                onToggle={() => onToggleYear(year)}
                showAccounts={true}
                editingCell={editingCell}
                editValue={editValue}
                onStartEdit={onStartEdit}
                onEditValueChange={onEditValueChange}
                onSaveEdit={onSaveEdit}
                onKeyDown={onKeyDown}
                masterAccounts={masterAccounts}
                showBasis={showBasis}
                showUnrealized={showUnrealized}
                onlyBasis={onlyBasis}
                canEdit={canEdit}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
