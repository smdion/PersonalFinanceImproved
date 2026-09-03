"use client";

import React from "react";
import {
  formatCurrency,
  formatPercent,
  accountDisplayName,
} from "@/lib/utils/format";
import { sumBy } from "@/lib/utils/math";
import { EditableCell } from "./editable-cell";
import {
  PARENT_CATEGORY_ROLLUPS,
  CASH_BASIS_HELP,
  combineCashBasisGainLoss,
} from "@/lib/config/display-labels";
import {
  isDiscountBasisEmployerContrib,
  tracksCostBasis,
  tracksRothBasis,
} from "@/lib/config/account-types";
import { HelpTip } from "@/components/ui/help-tip";
import { Badge } from "@/components/ui/badge";
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
  masterAccounts,
  showBasis,
  showUnrealized,
  onlyBasis,
  canEdit = true,
}: YearRowProps) {
  const gainColor = row.yearlyGainLoss >= 0 ? "text-green-600" : "text-red-600";
  // Per-account, data-driven gate — never assume a whole category is pure
  // ESPP discount (Brokerage can mix in cash-type sub-types like
  // mega-backdoor/after-tax). Rollup categories (Retirement/Portfolio) are
  // explicitly excluded: they blend discount-type and match-type employer
  // money, and showing this annotation there would need a visibly-labeled
  // basis toggle (deferred), not a silent always-on figure.
  const discountAccountsForYear = accounts.filter((a) =>
    isDiscountBasisEmployerContrib(a.accountType ?? "", a.subType),
  );
  const isRollupCategory = (
    PARENT_CATEGORY_ROLLUPS as readonly string[]
  ).includes(row.category);
  const yearCashBasisAnnotation =
    !isRollupCategory && discountAccountsForYear.length > 0 ? (
      <HelpTip
        text={`${formatCurrency(
          combineCashBasisGainLoss(
            row.yearlyGainLoss,
            discountAccountsForYear.reduce(
              (s, a) => s + a.employerContributions,
              0,
            ),
          ),
        )} ${CASH_BASIS_HELP}`}
      />
    ) : undefined;
  // Year-level basis rollups — sums over this year's real accounts, not a
  // proxy off AnnualRow's lifetime fields (those blend account types that
  // don't track basis the same way). Shown regardless of which category tab
  // is active — the tabs are filters over the same account data, not a
  // reason to hide these columns; only account type gates whether a given
  // row/account actually carries a basis figure.
  const costBasisAccountsForYear = accounts.filter((a) =>
    tracksCostBasis(a.accountType ?? ""),
  );
  const yearCostBasis = sumBy(costBasisAccountsForYear, (a) => {
    const master = masterAccounts?.find((m) => m.id === a.performanceAccountId);
    return Number(master?.costBasis ?? 0);
  });
  const yearCostBasisEnding = sumBy(
    costBasisAccountsForYear,
    (a) => a.endingBalance,
  );
  const yearUnrealized = yearCostBasisEnding - yearCostBasis;
  const rothBasisAccountsForYear = accounts.filter(
    (a) => tracksRothBasis(a.accountType ?? "") && a.ownerPersonId != null,
  );
  const yearContributionBasis = sumBy(
    rothBasisAccountsForYear,
    (a) => a.contributionBasis ?? 0,
  );
  const yearConversionBasis = sumBy(
    rothBasisAccountsForYear,
    (a) => a.conversionBasis ?? 0,
  );
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
        className={`border-subtle hover:bg-surface-sunken border-b ${showAccounts && accounts.length > 0 ? "cursor-pointer" : ""}`}
        onClick={showAccounts && accounts.length > 0 ? onToggle : undefined}
      >
        <td className="px-4 py-3 font-medium">
          <span className="flex items-center gap-2">
            {showAccounts && accounts.length > 0 && (
              <svg
                className={`text-faint h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
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
              <Badge color="blue" className="rounded-full">
                In Progress
              </Badge>
            )}
          </span>
        </td>
        {!onlyBasis && (
          <>
            <td className="px-4 py-3 text-right">
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
              <td className="px-4 py-3 text-right">
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
              <td className="px-4 py-3 text-right">
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
                  onStartEdit(
                    "annual",
                    row.id,
                    "distributions",
                    row.distributions,
                  )
                }
                onEditValueChange={onEditValueChange}
                onSaveEdit={onSaveEdit}
                onKeyDown={onKeyDown}
              />
            ) : (
              <td className="px-4 py-3 text-right">
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
              <td className="px-4 py-3 text-right">
                {formatCurrency(row.rollovers)}
              </td>
            )}
            {isEditable ? (
              <EditableCell
                value={row.fees}
                formatter={formatCurrency}
                isEditing={isEditingAnnual("fees")}
                editValue={editValue}
                onStartEdit={() =>
                  onStartEdit("annual", row.id, "fees", row.fees)
                }
                onEditValueChange={onEditValueChange}
                onSaveEdit={onSaveEdit}
                onKeyDown={onKeyDown}
              />
            ) : (
              <td className="px-4 py-3 text-right">
                {formatCurrency(row.fees)}
              </td>
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
                annotation={yearCashBasisAnnotation}
              />
            ) : (
              <td
                className={`px-4 py-3 text-right font-medium whitespace-nowrap ${gainColor}`}
              >
                {formatCurrency(row.yearlyGainLoss)}
                {yearCashBasisAnnotation}
              </td>
            )}
            {isEditable ? (
              <EditableCell
                value={row.endingBalance}
                formatter={formatCurrency}
                isEditing={isEditingAnnual("endingBalance")}
                editValue={editValue}
                onStartEdit={() =>
                  onStartEdit(
                    "annual",
                    row.id,
                    "endingBalance",
                    row.endingBalance,
                  )
                }
                onEditValueChange={onEditValueChange}
                onSaveEdit={onSaveEdit}
                onKeyDown={onKeyDown}
                className="font-medium"
              />
            ) : (
              <td className="px-4 py-3 text-right font-medium">
                {formatCurrency(row.endingBalance)}
              </td>
            )}
          </>
        )}
        {showBasis && (
          <>
            <td className="text-muted px-4 py-3 text-right">
              {costBasisAccountsForYear.length > 0
                ? formatCurrency(yearCostBasis)
                : "—"}
            </td>
            <td className="text-muted px-4 py-3 text-right">
              {rothBasisAccountsForYear.length > 0
                ? formatCurrency(yearContributionBasis)
                : "—"}
            </td>
            <td className="text-muted px-4 py-3 text-right">
              {rothBasisAccountsForYear.length > 0
                ? formatCurrency(yearConversionBasis)
                : "—"}
            </td>
          </>
        )}
        {showUnrealized && (
          <td
            className={`px-4 py-3 text-right font-medium ${
              costBasisAccountsForYear.length === 0
                ? ""
                : yearUnrealized >= 0
                  ? "text-green-600"
                  : "text-red-600"
            }`}
          >
            {costBasisAccountsForYear.length > 0
              ? formatCurrency(yearUnrealized)
              : "—"}
          </td>
        )}
        <td
          className={`px-4 py-3 text-right font-medium ${row.annualReturnPct !== null ? (row.annualReturnPct >= 0 ? "text-green-600" : "text-red-600") : ""}`}
        >
          {!onlyBasis &&
            (row.annualReturnPct !== null
              ? formatPercent(row.annualReturnPct, 1)
              : "\u2014")}
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
          const isDiscountBasis = isDiscountBasisEmployerContrib(
            a.accountType ?? "",
            a.subType,
          );
          const cashBasisGainLoss = combineCashBasisGainLoss(
            a.yearlyGainLoss,
            a.employerContributions,
          );
          const cashBasisAnnotation = isDiscountBasis ? (
            <HelpTip
              text={`${formatCurrency(cashBasisGainLoss)} ${CASH_BASIS_HELP}`}
            />
          ) : undefined;

          return (
            <React.Fragment key={a.id}>
              {isHistoricalDivider && (
                <tr className="bg-surface-elevated">
                  <td
                    colSpan={
                      (onlyBasis ? 2 : 10) +
                      (showBasis ? 3 : 0) +
                      (showUnrealized ? 1 : 0)
                    }
                    className="text-caption text-faint px-8 py-1 font-medium tracking-wide uppercase"
                  >
                    Historical Accounts
                  </td>
                </tr>
              )}
              <tr
                className={`border-subtle border-b ${isHistoricalDivider || (activeAccountCount !== undefined && idx >= activeAccountCount) ? "bg-surface-sunken/80 opacity-70" : "bg-surface-sunken/50"}`}
              >
                <td className="text-muted px-4 py-2 pl-10">
                  <span className="flex items-center gap-2">
                    <span>
                      {accountDisplayName({
                        ...a,
                        accountType: a.accountType ?? undefined,
                      })}
                    </span>
                  </span>
                </td>
                {!onlyBasis && (
                  <>
                    <td className="text-muted px-4 py-2 text-right">
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
                      <td className="text-muted px-4 py-2 text-right">
                        {formatCurrency(a.totalContributions)}
                      </td>
                    )}
                    {acctEditable ? (
                      <EditableCell
                        value={a.employerContributions}
                        formatter={formatCurrency}
                        isEditing={isEditingAccount(
                          a.id,
                          "employerContributions",
                        )}
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
                      <td className="text-muted px-4 py-2 text-right">
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
                      <td className="text-muted px-4 py-2 text-right">
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
                      <td className="text-muted px-4 py-2 text-right">
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
                      <td className="text-muted px-4 py-2 text-right">
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
                        annotation={cashBasisAnnotation}
                      />
                    ) : (
                      <td
                        className={`px-4 py-2 text-right whitespace-nowrap ${acctGainColor}`}
                      >
                        {formatCurrency(a.yearlyGainLoss)}
                        {cashBasisAnnotation}
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
                      <td className="text-muted px-4 py-2 text-right">
                        {formatCurrency(a.endingBalance)}
                      </td>
                    )}
                  </>
                )}
                {(() => {
                  const costTracked = tracksCostBasis(a.accountType ?? "");
                  const master = masterAccounts?.find(
                    (m) => m.id === a.performanceAccountId,
                  );
                  const basis = Number(master?.costBasis ?? 0);
                  const unrealized = a.endingBalance - basis;
                  // Roth basis is owner-attributed — a jointly-labeled
                  // account (ownerPersonId null) has no one to attach it
                  // to, same as Tax Buckets' handling of joint accounts.
                  const rothTracked =
                    tracksRothBasis(a.accountType ?? "") &&
                    a.ownerPersonId != null;
                  const contributionBasis = a.contributionBasis ?? 0;
                  const conversionBasis = a.conversionBasis ?? 0;
                  return (
                    <>
                      {showBasis && (
                        <>
                          {!costTracked ? (
                            <td className="text-faint px-4 py-2 text-right">
                              —
                            </td>
                          ) : acctEditable && master ? (
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
                            <td className="text-muted px-4 py-2 text-right">
                              {formatCurrency(basis)}
                            </td>
                          )}
                          {!rothTracked ? (
                            <td className="text-faint px-4 py-2 text-right">
                              —
                            </td>
                          ) : acctEditable ? (
                            <EditableCell
                              value={contributionBasis}
                              formatter={formatCurrency}
                              isEditing={isEditingAccount(
                                a.id,
                                "contributionBasis",
                              )}
                              editValue={editValue}
                              onStartEdit={() =>
                                onStartEdit(
                                  "basis",
                                  a.id,
                                  "contributionBasis",
                                  contributionBasis,
                                )
                              }
                              onEditValueChange={onEditValueChange}
                              onSaveEdit={onSaveEdit}
                              onKeyDown={onKeyDown}
                              className="text-muted"
                            />
                          ) : (
                            <td className="text-muted px-4 py-2 text-right">
                              {formatCurrency(contributionBasis)}
                            </td>
                          )}
                          {!rothTracked ? (
                            <td className="text-faint px-4 py-2 text-right">
                              —
                            </td>
                          ) : acctEditable ? (
                            <EditableCell
                              value={conversionBasis}
                              formatter={formatCurrency}
                              isEditing={isEditingAccount(
                                a.id,
                                "conversionBasis",
                              )}
                              editValue={editValue}
                              onStartEdit={() =>
                                onStartEdit(
                                  "basis",
                                  a.id,
                                  "conversionBasis",
                                  conversionBasis,
                                )
                              }
                              onEditValueChange={onEditValueChange}
                              onSaveEdit={onSaveEdit}
                              onKeyDown={onKeyDown}
                              className="text-muted"
                            />
                          ) : (
                            <td className="text-muted px-4 py-2 text-right">
                              {formatCurrency(conversionBasis)}
                            </td>
                          )}
                        </>
                      )}
                      {showUnrealized &&
                        (!costTracked ? (
                          <td className="text-faint px-4 py-2 text-right">—</td>
                        ) : (
                          <td
                            className={`px-4 py-2 text-right font-medium ${
                              unrealized >= 0
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {formatCurrency(unrealized)}
                          </td>
                        ))}
                    </>
                  );
                })()}
                <td
                  className={`px-4 py-2 text-right font-medium ${a.annualReturnPct !== null ? (a.annualReturnPct >= 0 ? "text-green-600" : "text-red-600") : "text-muted"}`}
                >
                  {!onlyBasis &&
                    (a.annualReturnPct !== null
                      ? formatPercent(a.annualReturnPct, 1)
                      : "\u2014")}
                </td>
              </tr>
            </React.Fragment>
          );
        })}
    </>
  );
}
