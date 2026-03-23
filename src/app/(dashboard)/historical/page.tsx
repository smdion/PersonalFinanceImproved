"use client";

import { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { JobsSettings } from "@/components/historical/jobs";
import {
  getAllCategories,
  ACCOUNT_TYPE_CONFIG,
} from "@/lib/config/account-types";
import Link from "next/link";
import {
  ColHeader,
  StickyLeftHeader,
  StickyLeftCell,
  NumCell,
  NoteableValue,
  ReadOnlyLineItemCell,
  PerfDetailCell,
  PerfEndBalCell,
  EditableCell,
  EditableRateCell,
  changeColor,
} from "@/components/historical/cells";
import type { HIItem, OAItem } from "@/components/historical/cells";

// All possible portfolio breakdown columns from config
const ALL_portfolioBreakdownCols = getAllCategories().map((cat) => ({
  key: cat,
  label: ACCOUNT_TYPE_CONFIG[cat].displayLabel,
}));

// Column group definitions — controls which columns are visible
const COLUMN_GROUPS = {
  netWorth: "Net Worth",
  performance: "Performance",
  portfolio: "Portfolio Breakdown",
  assets: "Assets",
  liabilities: "Liabilities",
  incomeTax: "Income & Tax",
  salary: "Salary",
} as const;

type ColumnGroup = keyof typeof COLUMN_GROUPS;

// Fields editable on the historical page (income/tax + otherLiabilities only — assets moved to Assets page)
const EDITABLE_FIELDS = new Set([
  "grossIncome",
  "combinedAgi",
  "ssaEarnings",
  "effectiveTaxRate",
  "taxesPaid",
  "propertyTaxes",
  "otherLiabilities",
]);

export default function HistoricalPage() {
  const [showJobHistory, setShowJobHistory] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<ColumnGroup>>(new Set());
  const { data, isLoading, error } = trpc.historical.getSummary.useQuery();
  const utils = trpc.useUtils();

  const invalidateAll = () => {
    utils.historical.invalidate();
    utils.networth.invalidate();
  };

  const updateMutation = trpc.historical.update.useMutation({
    onSuccess: invalidateAll,
  });
  const upsertNoteMutation = trpc.historical.upsertNote.useMutation({
    onSuccess: invalidateAll,
  });

  const toggleGroup = (group: ColumnGroup) => {
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <SkeletonChart height={256} />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-red-600 text-sm">
        Failed to load historical data: {error.message}
      </p>
    );
  }

  if (!data || data.history.length === 0) {
    return (
      <div>
        <PageHeader title="Historical" />
        <EmptyState
          message="No historical data available yet."
          hint="Add portfolio snapshots and finalize year-end performance to build history."
        />
      </div>
    );
  }

  const { history, notes } = data;
  const sorted = [...history].sort((a, b) => b.year - a.year);
  const latest = sorted[0]!;
  const earliest = sorted[sorted.length - 1]!;
  const totalGrowth = latest.netWorth - earliest.netWorth;
  const peopleNames = Array.from(
    new Set(history.flatMap((h) => Object.keys(h.salaries))),
  );

  return (
    <div>
      <PageHeader title="Historical">
        <button
          onClick={() => setShowJobHistory(!showJobHistory)}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            showJobHistory
              ? "bg-blue-100 text-blue-800 border border-blue-300"
              : "bg-surface-elevated text-muted border hover:bg-surface-strong"
          }`}
        >
          {showJobHistory ? "Hide" : "Show"} Job History
        </button>
      </PageHeader>

      {showJobHistory && (
        <Card title="Job History" className="mb-6">
          <JobsSettings />
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card
          title={
            <>
              Current Net Worth{""}
              <HelpTip text="Your most recent year-end or year-to-date net worth figure" />
            </>
          }
        >
          <Metric
            value={formatCurrency(latest.netWorth)}
            label={`${latest.year}${latest.isCurrent ? " (YTD)" : ""}`}
          />
        </Card>
        <Card
          title={
            <>
              Total Growth{""}
              <HelpTip text="The dollar change in net worth from the earliest year tracked to now" />
            </>
          }
        >
          <Metric
            value={formatCurrency(totalGrowth)}
            label={`Since ${earliest.year}`}
            trend={{
              value: formatCurrency(totalGrowth),
              positive: totalGrowth >= 0,
            }}
          />
        </Card>
        <Card
          title={
            <>
              Years Tracked{""}
              <HelpTip text="Number of year-end snapshots recorded, including the current year if in progress" />
            </>
          }
        >
          <Metric value={String(sorted.length)} label="Year-end snapshots" />
        </Card>
      </div>

      {/* Historical data table */}
      <Card
        title="Year-End History"
        className="mb-6"
        headerRight={
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.entries(COLUMN_GROUPS) as [ColumnGroup, string][]).map(
              ([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleGroup(key)}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    hiddenGroups.has(key)
                      ? "bg-surface-elevated text-faint border border-default"
                      : "bg-surface-elevated text-blue-600 border border-blue-500/30"
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        }
      >
        <HistoricalTable
          rows={sorted}
          peopleNames={peopleNames}
          hiddenGroups={hiddenGroups}
          notes={notes}
          onSave={(year, fields) => updateMutation.mutate({ year, fields })}
          onUpsertNote={(year, field, note) =>
            upsertNoteMutation.mutate({ year, field, note })
          }
          isSaving={updateMutation.isPending || upsertNoteMutation.isPending}
        />
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Historical Table
// ---------------------------------------------------------------------------

type HistoricalRow = {
  year: number;
  isCurrent: boolean;
  netWorth: number;
  portfolioTotal: number;
  portfolioByType: Record<string, number>;
  perfBeginningBalance: number | null;
  perfContributions: number | null;
  perfEmployerMatch: number | null;
  perfGainLoss: number | null;
  perfEndingBalance: number | null;
  perfReturnPct: number | null;
  perfByAccount: {
    label: string;
    beginningBalance: number;
    contributions: number;
    employerMatch: number;
    gainLoss: number;
    endingBalance: number;
  }[];
  perfLastUpdated: string | null;
  snapshotDate: string | null;
  cash: number;
  houseValue: number;
  otherAssets: number;
  homeImprovements: number;
  homeImprovementItems: HIItem[];
  otherAssetItems: OAItem[];
  mortgageBalance: number;
  otherLiabilities: number;
  grossIncome: number;
  combinedAgi: number;
  ssaEarnings: number | null;
  effectiveTaxRate: number | null;
  taxesPaid: number | null;
  propertyTaxes: number | null;
  salaries: Record<string, number>;
};

function HistoricalTable({
  rows,
  peopleNames,
  hiddenGroups,
  notes,
  onSave,
  onUpsertNote,
  isSaving,
}: {
  rows: HistoricalRow[];
  peopleNames: string[];
  hiddenGroups: Set<ColumnGroup>;
  notes: Record<string, string>;
  onSave: (year: number, fields: Record<string, number>) => void;
  onUpsertNote: (year: number, field: string, note: string) => void;
  isSaving: boolean;
}) {
  const showNW = !hiddenGroups.has("netWorth");
  const showPerf = !hiddenGroups.has("performance");
  const showPortfolio = !hiddenGroups.has("portfolio");
  const showAssets = !hiddenGroups.has("assets");
  const showLiab = !hiddenGroups.has("liabilities");
  const showIncome = !hiddenGroups.has("incomeTax");
  const showSalary = !hiddenGroups.has("salary") && peopleNames.length > 0;

  // Only show portfolio breakdown columns that have data in at least one year
  const portfolioBreakdownCols = ALL_portfolioBreakdownCols.filter((col) =>
    rows.some((row) => (row.portfolioByType[col.key] ?? 0) !== 0),
  );

  // Current-year row for performance"last updated" display
  const currentRow = rows.find((r) => r.isCurrent);
  const perfLastUpdatedDisplay = currentRow?.perfLastUpdated
    ? new Date(currentRow.perfLastUpdated).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs whitespace-nowrap border-collapse">
        <thead>
          {/* Group headers — sticky Year, then scrollable groups */}
          <tr className="border-b border-strong">
            <th className="sticky left-0 z-20 bg-surface-primary py-1 px-1 border-r border-strong" />
            {showNW && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={3}
              >
                <span className="inline-flex items-center gap-1">
                  Net Worth
                  <Link
                    href="/networth"
                    className="text-blue-600 hover:text-blue-700"
                    title="View Net Worth page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showPerf && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={6}
              >
                <span className="inline-flex items-center gap-1">
                  Performance
                  {perfLastUpdatedDisplay && (
                    <span className="ml-1 text-[9px] text-faint font-normal">
                      (updated {perfLastUpdatedDisplay})
                    </span>
                  )}
                  <Link
                    href="/brokerage"
                    className="text-blue-600 hover:text-blue-700"
                    title="View Performance page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showPortfolio && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={1 + portfolioBreakdownCols.length}
              >
                <span className="inline-flex items-center gap-1">
                  Portfolio Breakdown
                  <Link
                    href="/brokerage"
                    className="text-blue-600 hover:text-blue-700"
                    title="View Portfolio page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showAssets && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={4}
              >
                <span className="inline-flex items-center gap-1">
                  Assets
                  <Link
                    href="/assets"
                    className="text-blue-600 hover:text-blue-700"
                    title="Manage on Assets page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showLiab && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={2}
              >
                <span className="inline-flex items-center gap-1">
                  Liabilities
                  <Link
                    href="/liabilities"
                    className="text-blue-600 hover:text-blue-700"
                    title="Manage on Liabilities page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showIncome && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={6}
              >
                <span className="inline-flex items-center gap-1">
                  Income & Tax
                  <Link
                    href="/paycheck"
                    className="text-blue-600 hover:text-blue-700"
                    title="View Paycheck page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
            {showSalary && (
              <th
                className="text-center px-1 py-1 text-faint font-medium border-l"
                colSpan={peopleNames.length}
              >
                <span className="inline-flex items-center gap-1">
                  Salary
                  <Link
                    href="/paycheck"
                    className="text-blue-600 hover:text-blue-700"
                    title="View Paycheck page"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                  </Link>
                </span>
              </th>
            )}
          </tr>
          {/* Column headers — sticky Year, then scrollable */}
          <tr className="border-b">
            <StickyLeftHeader offset={0} borderRight>
              Year
            </StickyLeftHeader>
            {showNW && (
              <>
                <ColHeader border>Net Worth</ColHeader>
                <ColHeader>$ Chg</ColHeader>
                <ColHeader>% Chg</ColHeader>
              </>
            )}
            {showPerf && (
              <>
                <ColHeader border>Beg Bal</ColHeader>
                <ColHeader>Contribs</ColHeader>
                <ColHeader>Match</ColHeader>
                <ColHeader>Gain/Loss</ColHeader>
                <ColHeader>End Bal</ColHeader>
                <ColHeader>Return %</ColHeader>
              </>
            )}
            {showPortfolio && (
              <>
                <ColHeader border>Portfolio</ColHeader>
                {portfolioBreakdownCols.map((col) => (
                  <ColHeader key={col.key}>{col.label}</ColHeader>
                ))}
              </>
            )}
            {showAssets && (
              <>
                <ColHeader border>Cash</ColHeader>
                <ColHeader>House</ColHeader>
                <ColHeader>Home Imp</ColHeader>
                <ColHeader>Other</ColHeader>
              </>
            )}
            {showLiab && (
              <>
                <ColHeader border>Mortgage</ColHeader>
                <ColHeader>Other</ColHeader>
              </>
            )}
            {showIncome && (
              <>
                <ColHeader border>Gross</ColHeader>
                <ColHeader>AGI</ColHeader>
                <ColHeader>SSA</ColHeader>
                <ColHeader>Taxes</ColHeader>
                <ColHeader>Eff Rate</ColHeader>
                <ColHeader>Prop Tax</ColHeader>
              </>
            )}
            {showSalary &&
              peopleNames.map((name, idx) => (
                <ColHeader key={name} border={idx === 0}>
                  {name}
                </ColHeader>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const prev = rows[i + 1];
            const dollarChange = prev ? row.netWorth - prev.netWorth : null;
            const pctChange =
              prev && prev.netWorth !== 0
                ? (row.netWorth - prev.netWorth) / Math.abs(prev.netWorth)
                : null;

            return (
              <tr
                key={row.year}
                className={`border-b border-subtle hover:bg-surface-sunken/50 ${
                  row.isCurrent ? "bg-blue-50/30" : ""
                }`}
              >
                {/* Year — sticky left */}
                <StickyLeftCell offset={0} borderRight>
                  <span className="font-medium">{row.year}</span>
                  {row.isCurrent && (
                    <span className="ml-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-1 py-0.5 rounded">
                      YTD
                    </span>
                  )}
                </StickyLeftCell>
                {/* Net Worth group — scrollable, toggleable */}
                {showNW && (
                  <>
                    <td className="text-right py-1.5 px-1.5 font-semibold border-l">
                      <NoteableValue
                        year={row.year}
                        field="netWorth"
                        notes={notes}
                        onUpsertNote={onUpsertNote}
                        isCurrent={row.isCurrent}
                      >
                        <Tooltip
                          side="bottom"
                          maxWidth={300}
                          lines={[
                            `Portfolio: ${formatCurrency(row.portfolioTotal)}`,
                            `Cash: ${formatCurrency(row.cash)}`,
                            `House: ${formatCurrency(row.houseValue)}`,
                            ...(row.otherAssets > 0
                              ? [
                                  `Other Assets: ${formatCurrency(row.otherAssets)}`,
                                ]
                              : []),
                            `Mortgage: -${formatCurrency(row.mortgageBalance)}`,
                            ...(row.otherLiabilities > 0
                              ? [
                                  `Other Liabilities: -${formatCurrency(row.otherLiabilities)}`,
                                ]
                              : []),
                          ]}
                        >
                          <span className="cursor-help border-b border-dotted border-strong">
                            {formatCurrency(row.netWorth)}
                          </span>
                        </Tooltip>
                      </NoteableValue>
                    </td>
                    <td
                      className={`text-right py-1.5 px-1.5 ${changeColor(dollarChange)}`}
                    >
                      {dollarChange !== null
                        ? `${dollarChange >= 0 ? "+" : ""}${formatCurrency(dollarChange)}`
                        : "\u2014"}
                    </td>
                    <td
                      className={`text-right py-1.5 px-1.5 ${changeColor(pctChange)}`}
                    >
                      {pctChange !== null
                        ? `${pctChange >= 0 ? "+" : ""}${formatPercent(pctChange, 1)}`
                        : "\u2014"}
                    </td>
                  </>
                )}
                {/* Performance */}
                {showPerf && (
                  <>
                    <PerfDetailCell
                      value={row.perfBeginningBalance}
                      accounts={row.perfByAccount}
                      field="beginningBalance"
                      border
                    />
                    <PerfDetailCell
                      value={row.perfContributions}
                      accounts={row.perfByAccount}
                      field="contributions"
                    />
                    <PerfDetailCell
                      value={row.perfEmployerMatch}
                      accounts={row.perfByAccount}
                      field="employerMatch"
                    />
                    <PerfDetailCell
                      value={row.perfGainLoss}
                      accounts={row.perfByAccount}
                      field="gainLoss"
                      change
                    />
                    {row.isCurrent &&
                    row.perfLastUpdated &&
                    row.snapshotDate ? (
                      <PerfEndBalCell
                        value={row.perfEndingBalance}
                        perfLastUpdated={row.perfLastUpdated}
                        snapshotDate={row.snapshotDate}
                      />
                    ) : (
                      <PerfDetailCell
                        value={row.perfEndingBalance}
                        accounts={row.perfByAccount}
                        field="endingBalance"
                      />
                    )}
                    <td className="text-right py-1.5 px-1.5">
                      {row.perfReturnPct !== null
                        ? formatPercent(row.perfReturnPct, 1)
                        : "\u2014"}
                    </td>
                  </>
                )}
                {/* Portfolio Breakdown */}
                {showPortfolio && (
                  <>
                    <td className="text-right py-1.5 px-1.5 font-semibold border-l">
                      {row.perfByAccount.length > 0 ? (
                        <Tooltip
                          side="bottom"
                          maxWidth={400}
                          lines={row.perfByAccount
                            .filter((a) => a.endingBalance !== 0)
                            .sort((a, b) => b.endingBalance - a.endingBalance)
                            .map(
                              (a) =>
                                `${a.label}: ${formatCurrency(a.endingBalance)}`,
                            )}
                        >
                          <span className="cursor-help border-b border-dotted border-strong">
                            {formatCurrency(row.portfolioTotal)}
                          </span>
                        </Tooltip>
                      ) : (
                        formatCurrency(row.portfolioTotal)
                      )}
                    </td>
                    {portfolioBreakdownCols.map((col) => (
                      <NumCell
                        key={col.key}
                        value={row.portfolioByType[col.key] ?? 0}
                      />
                    ))}
                  </>
                )}
                {/* Assets — read-only, managed on Assets page */}
                {showAssets && (
                  <>
                    <NumCell value={row.cash} border />
                    <NumCell value={row.houseValue} />
                    <ReadOnlyLineItemCell
                      value={row.homeImprovements}
                      items={row.homeImprovementItems}
                      year={row.year}
                      type="homeImprovement"
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      isCurrent={row.isCurrent}
                    />
                    <ReadOnlyLineItemCell
                      value={row.otherAssets}
                      items={row.otherAssetItems.map((i, idx) => ({
                        id: idx,
                        year: row.year,
                        description: i.name,
                        cost: i.value,
                        note: i.note,
                      }))}
                      year={row.year}
                      type="otherAsset"
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      isCurrent={row.isCurrent}
                    />
                  </>
                )}
                {/* Liabilities */}
                {showLiab && (
                  <>
                    <NumCell value={row.mortgageBalance} border red />
                    <EditableCell
                      value={row.otherLiabilities}
                      field="otherLiabilities"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      red
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                  </>
                )}
                {/* Income & Tax */}
                {showIncome && (
                  <>
                    <EditableCell
                      value={row.grossIncome}
                      field="grossIncome"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      border
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                    <EditableCell
                      value={row.combinedAgi}
                      field="combinedAgi"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                    <EditableCell
                      value={row.ssaEarnings}
                      field="ssaEarnings"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                    <EditableCell
                      value={row.taxesPaid}
                      field="taxesPaid"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      red
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                    <EditableRateCell
                      value={row.effectiveTaxRate}
                      field="effectiveTaxRate"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                    />
                    <EditableCell
                      value={row.propertyTaxes}
                      field="propertyTaxes"
                      year={row.year}
                      isCurrent={row.isCurrent}
                      onSave={onSave}
                      isSaving={isSaving}
                      red
                      notes={notes}
                      onUpsertNote={onUpsertNote}
                      editableFields={EDITABLE_FIELDS}
                    />
                  </>
                )}
                {/* Salary */}
                {showSalary &&
                  peopleNames.map((name, idx) => (
                    <NumCell
                      key={name}
                      value={row.salaries[name] ?? null}
                      border={idx === 0}
                    />
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
