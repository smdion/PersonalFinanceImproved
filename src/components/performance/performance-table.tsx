"use client";

import React from "react";
import { HelpTip } from "@/components/ui/help-tip";
import { YearRow } from "./year-row";
import type {
  AnnualRow,
  AccountRow,
  MasterAccount,
  EditingCell,
  CreateAccountData,
} from "./types";
import { accountTypeToPerformanceCategory } from "@/lib/config/display-labels";

export function PerformanceTable({
  filtered,
  accountRows,
  masterAccounts,
  activeCategory,
  expandedYear,
  onToggleYear,
  editingCell,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
  onDeleteAccount,
  showAddAccount,
  onShowAddAccount,
  onCreateAccount,
  onCancelAddAccount,
  isCreatingAccount,
  canEdit,
}: {
  filtered: AnnualRow[];
  accountRows: AccountRow[];
  masterAccounts: MasterAccount[];
  activeCategory: string;
  expandedYear: number | null;
  onToggleYear: (year: number) => void;
  editingCell: EditingCell;
  editValue: string;
  onStartEdit: (
    type: "annual" | "account",
    id: number,
    field: string,
    currentValue: number,
  ) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDeleteAccount: (id: number, label: string) => void;
  showAddAccount: number | null;
  onShowAddAccount: (year: number | null) => void;
  onCreateAccount: (data: CreateAccountData) => void;
  onCancelAddAccount: () => void;
  isCreatingAccount: boolean;
  canEdit?: boolean;
}) {
  const years = Array.from(new Set(filtered.map((r) => r.year))).sort(
    (a, b) => b - a,
  );

  return (
    <div className="bg-surface-primary rounded-lg border shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-sunken border-b">
            <th className="text-left px-4 py-3 text-muted font-medium">Year</th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Beginning
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Contributions
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Employer Contrib
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Distributions
              <HelpTip text="Withdrawals or money taken out of accounts during the year" />
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Rollovers
              <HelpTip text="Internal transfers between accounts. Positive = money rolled in, negative = money rolled out. Should net to zero at Portfolio level." />
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Fees
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Gain/Loss
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Ending
              <HelpTip text="Balance based on tracked performance data. For in-progress years this may lag behind the Portfolio Value (which uses the latest snapshot)." />
            </th>
            <th className="text-right px-4 py-3 text-muted font-medium">
              Return
              <HelpTip text="Annual rate of return calculated from gains relative to average invested balance" />
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const row = filtered.find((r) => r.year === year);
            if (!row) return null;
            const isExpanded = expandedYear === year;
            const yearAccountsAll = accountRows
              .filter((a) => {
                if (a.year !== year) return false;
                if (activeCategory === "Portfolio") return true;
                if (activeCategory === "Retirement")
                  return a.parentCategory === "Retirement";
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
                onDeleteAccount={onDeleteAccount}
                showAddAccount={showAddAccount === year}
                onShowAddAccount={() =>
                  onShowAddAccount(showAddAccount === year ? null : year)
                }
                onCreateAccount={onCreateAccount}
                onCancelAddAccount={onCancelAddAccount}
                isCreatingAccount={isCreatingAccount}
                activeCategory={activeCategory}
                masterAccounts={masterAccounts}
                canEdit={canEdit}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
