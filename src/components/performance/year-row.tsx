"use client";

import React from "react";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
} from "@/lib/utils/format";
import { EditableCell } from "./editable-cell";
import { PERF_CATEGORY_BROKERAGE } from "@/lib/config/display-labels";
import type { YearRowProps } from "./types";

export function YearRow({
  row,
  accounts,
  activeAccountCount,
  isExpanded,
  onToggle,
  showAccounts,
  editingCell,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
  activeCategory,
  masterAccounts,
  canEdit = true,
}: YearRowProps) {
  const gainColor = row.yearlyGainLoss >= 0 ? "text-green-600" : "text-red-600";
  const isEditable = canEdit;
  const isEditingAnnual = (field: string) =>
    editingCell?.type === "annual" &&
    editingCell.id === row.id &&
    editingCell.field === field;
  const isEditingAccount = (id: number, field: string) =>
    editingCell?.type === "account" &&
    editingCell.id === id &&
    editingCell.field === field;

  return (
    <>
      <tr
        className={`border-b border-subtle hover:bg-surface-sunken ${showAccounts && accounts.length > 0 ? "cursor-pointer" : ""}`}
        onClick={showAccounts && accounts.length > 0 ? onToggle : undefined}
      >
        <td className="px-4 py-3 font-medium">
          <span className="flex items-center gap-2">
            {showAccounts && accounts.length > 0 && (
              <svg
                className={`w-3 h-3 text-faint transition-transform ${isExpanded ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
            {row.year}
            {row.isCurrentYear && (
              <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">
                In Progress
              </span>
            )}
          </span>
        </td>
        <td className="text-right px-4 py-3">
          {formatCurrency(row.beginningBalance)}
        </td>
        {isEditable ? (
          <EditableCell
            value={row.totalContributions}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("totalContributions")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit(
                "annual",
                row.id,
                "totalContributions",
                row.totalContributions,
              )
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <td className="text-right px-4 py-3">
            {formatCurrency(row.totalContributions)}
          </td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.employerContributions}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("employerContributions")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit(
                "annual",
                row.id,
                "employerContributions",
                row.employerContributions,
              )
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <td className="text-right px-4 py-3">
            {formatCurrency(row.employerContributions)}
          </td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.distributions}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("distributions")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit("annual", row.id, "distributions", row.distributions)
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <td className="text-right px-4 py-3">
            {formatCurrency(row.distributions)}
          </td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.rollovers}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("rollovers")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit("annual", row.id, "rollovers", row.rollovers)
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <td className="text-right px-4 py-3">
            {formatCurrency(row.rollovers)}
          </td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.fees}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("fees")}
            editValue={editValue}
            onStartEdit={() => onStartEdit("annual", row.id, "fees", row.fees)}
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <td className="text-right px-4 py-3">{formatCurrency(row.fees)}</td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.yearlyGainLoss}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("yearlyGainLoss")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit(
                "annual",
                row.id,
                "yearlyGainLoss",
                row.yearlyGainLoss,
              )
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
            className={`font-medium ${gainColor}`}
          />
        ) : (
          <td className={`text-right px-4 py-3 font-medium ${gainColor}`}>
            {formatCurrency(row.yearlyGainLoss)}
          </td>
        )}
        {isEditable ? (
          <EditableCell
            value={row.endingBalance}
            formatter={formatCurrency}
            isEditing={isEditingAnnual("endingBalance")}
            editValue={editValue}
            onStartEdit={() =>
              onStartEdit("annual", row.id, "endingBalance", row.endingBalance)
            }
            onEditValueChange={onEditValueChange}
            onSaveEdit={onSaveEdit}
            onKeyDown={onKeyDown}
            className="font-medium"
          />
        ) : (
          <td className="text-right px-4 py-3 font-medium">
            {formatCurrency(row.endingBalance)}
          </td>
        )}
        {activeCategory === PERF_CATEGORY_BROKERAGE && (
          <>
            <td className="text-right px-4 py-3 text-muted">
              {formatCurrency(row.lifetimeContributions + row.lifetimeMatch)}
            </td>
            <td
              className={`text-right px-4 py-3 font-medium ${
                row.endingBalance -
                  row.lifetimeContributions -
                  row.lifetimeMatch >=
                0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {formatCurrency(
                row.endingBalance -
                  row.lifetimeContributions -
                  row.lifetimeMatch,
              )}
            </td>
          </>
        )}
        <td
          className={`text-right px-4 py-3 font-medium ${row.annualReturnPct !== null ? (row.annualReturnPct >= 0 ? "text-green-600" : "text-red-600") : ""}`}
        >
          {row.annualReturnPct !== null
            ? formatPercent(row.annualReturnPct, 1)
            : "\u2014"}
        </td>
      </tr>
      {isExpanded &&
        accounts.map((a, idx) => {
          const acctEditable = row.isCurrentYear && canEdit;
          const acctGainColor =
            a.yearlyGainLoss >= 0 ? "text-green-600" : "text-red-600";
          const isHistoricalDivider =
            activeAccountCount !== undefined &&
            idx === activeAccountCount &&
            idx > 0;

          return (
            <React.Fragment key={a.id}>
              {isHistoricalDivider && (
                <tr className="bg-surface-elevated">
                  <td
                    colSpan={13}
                    className="px-8 py-1 text-[10px] text-faint uppercase tracking-wide font-medium"
                  >
                    Historical Accounts
                  </td>
                </tr>
              )}
              <tr
                className={`border-b border-subtle ${isHistoricalDivider || (activeAccountCount !== undefined && idx >= activeAccountCount) ? "bg-surface-sunken/80 opacity-70" : "bg-surface-sunken/50"}`}
              >
                <td className="px-4 py-2 pl-10 text-muted">
                  <span className="flex items-center gap-2">
                    <span>
                      {accountDisplayName({
                        ...a,
                        accountType: a.accountType ?? undefined,
                      })}
                    </span>
                  </span>
                </td>
                <td className="text-right px-4 py-2 text-muted">
                  {formatCurrency(a.beginningBalance)}
                </td>
                {acctEditable ? (
                  <EditableCell
                    value={a.totalContributions}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "totalContributions")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit(
                        "account",
                        a.id,
                        "totalContributions",
                        a.totalContributions,
                      )
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.totalContributions)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.employerContributions}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "employerContributions")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit(
                        "account",
                        a.id,
                        "employerContributions",
                        a.employerContributions,
                      )
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.employerContributions)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.distributions}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "distributions")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit(
                        "account",
                        a.id,
                        "distributions",
                        a.distributions,
                      )
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.distributions)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.rollovers}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "rollovers")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit("account", a.id, "rollovers", a.rollovers)
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.rollovers)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.fees}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "fees")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit("account", a.id, "fees", a.fees)
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.fees)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.yearlyGainLoss}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "yearlyGainLoss")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit(
                        "account",
                        a.id,
                        "yearlyGainLoss",
                        a.yearlyGainLoss,
                      )
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className={acctGainColor}
                  />
                ) : (
                  <td className={`text-right px-4 py-2 ${acctGainColor}`}>
                    {formatCurrency(a.yearlyGainLoss)}
                  </td>
                )}
                {acctEditable ? (
                  <EditableCell
                    value={a.endingBalance}
                    formatter={formatCurrency}
                    isEditing={isEditingAccount(a.id, "endingBalance")}
                    editValue={editValue}
                    onStartEdit={() =>
                      onStartEdit(
                        "account",
                        a.id,
                        "endingBalance",
                        a.endingBalance,
                      )
                    }
                    onEditValueChange={onEditValueChange}
                    onSaveEdit={onSaveEdit}
                    onKeyDown={onKeyDown}
                    className="text-muted"
                  />
                ) : (
                  <td className="text-right px-4 py-2 text-muted">
                    {formatCurrency(a.endingBalance)}
                  </td>
                )}
                {activeCategory === PERF_CATEGORY_BROKERAGE &&
                  (() => {
                    const master = masterAccounts?.find(
                      (m) => m.id === a.performanceAccountId,
                    );
                    const basis = Number(master?.costBasis ?? 0);
                    const unrealized = a.endingBalance - basis;
                    return (
                      <>
                        {acctEditable && master ? (
                          <EditableCell
                            value={basis}
                            formatter={formatCurrency}
                            isEditing={
                              editingCell?.type === "master" &&
                              editingCell?.id === master.id &&
                              editingCell?.field === "costBasis"
                            }
                            editValue={editValue}
                            onStartEdit={() =>
                              onStartEdit(
                                "master",
                                master.id,
                                "costBasis",
                                basis,
                              )
                            }
                            onEditValueChange={onEditValueChange}
                            onSaveEdit={onSaveEdit}
                            onKeyDown={onKeyDown}
                            className="text-muted"
                          />
                        ) : (
                          <td className="text-right px-4 py-2 text-muted">
                            {formatCurrency(basis)}
                          </td>
                        )}
                        <td
                          className={`text-right px-4 py-2 font-medium ${
                            unrealized >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatCurrency(unrealized)}
                        </td>
                      </>
                    );
                  })()}
                <td
                  className={`text-right px-4 py-2 font-medium ${a.annualReturnPct !== null ? (a.annualReturnPct >= 0 ? "text-green-600" : "text-red-600") : "text-muted"}`}
                >
                  {a.annualReturnPct !== null
                    ? formatPercent(a.annualReturnPct, 1)
                    : "\u2014"}
                </td>
              </tr>
            </React.Fragment>
          );
        })}
    </>
  );
}
