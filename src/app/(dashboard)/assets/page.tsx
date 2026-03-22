"use client";

import { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { InlineEdit } from "@/components/ui/inline-edit";
import { formatCurrency } from "@/lib/utils/format";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpTip } from "@/components/ui/help-tip";
import Link from "next/link";
import {
  ColHeader,
  StickyLeftHeader,
  StickyLeftCell,
  NumCell,
} from "@/components/historical/cells";

function SyncBadge({ source }: { source: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
      Synced from {source.toUpperCase()}
    </span>
  );
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="ml-1.5 text-blue-600 hover:text-blue-700 text-[10px] inline-flex items-center gap-0.5"
      title={label}
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
  );
}

export default function AssetsPage() {
  const { data, isLoading, error } = trpc.assets.getSummary.useQuery();
  const utils = trpc.useUtils();

  const [addingAsset, setAddingAsset] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetValue, setNewAssetValue] = useState("");

  const invalidateAll = () => {
    utils.assets.invalidate();
    utils.historical.invalidate();
    utils.networth.invalidate();
  };

  const updateMutation = trpc.assets.updateAsset.useMutation({
    onSuccess: invalidateAll,
  });
  const upsertOAMutation = trpc.assets.upsertOtherAsset.useMutation({
    onSuccess: () => {
      invalidateAll();
      setAddingAsset(false);
      setNewAssetName("");
      setNewAssetValue("");
    },
  });
  const deleteOAMutation = trpc.assets.deleteOtherAsset.useMutation({
    onSuccess: invalidateAll,
  });

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
      <p className="text-red-600 text-sm">Failed to load asset data: {error.message}</p>
    );
  }

  if (!data || data.history.length === 0) {
    return (
      <div>
        <PageHeader title="Assets" />
        <EmptyState
          message="No asset data available yet."
          hint="Add year-end snapshots to start tracking assets."
        />
      </div>
    );
  }

  const { current, history } = data;
  const currentYear = new Date().getFullYear();
  const hasHouse = current.hasHouse;
  const apiLabel =
    current.activeBudgetApi !== "none" ? current.activeBudgetApi : "";

  // Historical table — filter out all-zero rows and sort descending
  const sorted = [...history]
    .filter(
      (row) =>
        row.isCurrent ||
        row.cash !== 0 ||
        row.houseValue !== 0 ||
        row.homeImprovements !== 0 ||
        row.otherAssets !== 0
    )
    .sort((a, b) => b.year - a.year);

  return (
    <div>
      <PageHeader title="Assets" />

      {/* Summary cards — headline metrics only, no detail duplication */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card
          title={
            <>
              Total Assets{" "}
              <HelpTip text="Sum of cash, house equity, and other assets (excludes portfolio — see Net Worth)" />
            </>
          }
        >
          <Metric
            value={formatCurrency(current.totalAssets)}
            label={`${currentYear} (YTD)`}
          />
        </Card>
        <Card
          title={
            <>
              Cash{" "}
              <HelpTip text="Liquid cash across all on-budget accounts" />
            </>
          }
        >
          <Metric
            value={formatCurrency(current.cash)}
            label={
              current.cashSource !== "manual"
                ? `Synced from ${apiLabel.toUpperCase()}`
                : "Manual entry"
            }
          />
        </Card>
        {hasHouse ? (
          <Card
            title={
              <>
                House Equity{" "}
                <HelpTip text="Home value minus mortgage balance" />
              </>
            }
            href="/house"
          >
            <Metric
              value={formatCurrency(current.houseEquity)}
              label={`${formatCurrency(current.houseValue)} value − ${formatCurrency(current.mortgageBalance)} mortgage`}
            />
          </Card>
        ) : (
          <Card
            title={
              <>
                Other Assets{" "}
                <HelpTip text="Non-portfolio assets like vehicles, jewelry" />
              </>
            }
          >
            <Metric
              value={formatCurrency(current.otherAssetsTotal)}
              label={`${current.otherAssetItems.length} item${current.otherAssetItems.length !== 1 ? "s" : ""} tracked`}
            />
          </Card>
        )}
      </div>

      {/* Unified Asset Breakdown — single card with all editable line items */}
      <Card
        title={
          <>
            Asset Breakdown{" "}
            <HelpTip text="All non-portfolio assets for the current year. Click any value with a pencil icon to edit it." />
          </>
        }
        className="mb-6"
      >
        <div className="space-y-4 text-sm">
          {/* Cash section */}
          <div>
            <h4 className="text-xs font-semibold text-faint uppercase tracking-wide mb-1">
              Cash
            </h4>
            <div className="flex justify-between items-center py-1.5 border-b border-subtle">
              <span className="text-muted">
                Liquid Cash
                {current.cashSource !== "manual" && (
                  <SyncBadge source={apiLabel} />
                )}
              </span>
              {current.cashSource === "manual" ? (
                <InlineEdit
                  value={String(current.cash)}
                  onSave={(v) =>
                    updateMutation.mutate({
                      year: currentYear,
                      fields: { cash: Number(v) },
                    })
                  }
                  formatDisplay={(v) => formatCurrency(Number(v))}
                  parseInput={(v) => v.replace(/[^0-9.-]/g, "")}
                  type="number"
                  className="font-medium"
                />
              ) : (
                <span className="font-medium">
                  {formatCurrency(current.cash)}
                </span>
              )}
            </div>
          </div>

          {/* Property section — only if house exists */}
          {hasHouse && (
            <div>
              <h4 className="text-xs font-semibold text-faint uppercase tracking-wide mb-1">
                Property
                <ExternalLink href="/house" label="Manage on House page" />
              </h4>
              <div className="flex justify-between items-center py-1.5 border-b border-subtle">
                <span className="text-muted">
                  Home Value
                  {current.houseValueSynced && (
                    <SyncBadge source={apiLabel} />
                  )}
                </span>
                {!current.houseValueSynced ? (
                  <InlineEdit
                    value={String(current.houseValue)}
                    onSave={(v) =>
                      updateMutation.mutate({
                        year: currentYear,
                        fields: { houseValue: Number(v) },
                      })
                    }
                    formatDisplay={(v) => formatCurrency(Number(v))}
                    parseInput={(v) => v.replace(/[^0-9.-]/g, "")}
                    type="number"
                    className="font-medium"
                  />
                ) : (
                  <span className="font-medium">
                    {formatCurrency(current.houseValue)}
                  </span>
                )}
              </div>
              <div className="flex justify-between items-center py-1.5 border-b border-subtle">
                <span className="text-muted">
                  Mortgage Balance
                  {current.mortgageSynced && (
                    <SyncBadge source={apiLabel} />
                  )}
                  <ExternalLink
                    href="/liabilities"
                    label="Manage on Liabilities page"
                  />
                </span>
                <span className="font-medium text-red-600">
                  −{formatCurrency(current.mortgageBalance)}
                </span>
              </div>
              {current.homeImprovements > 0 && (
                <div className="flex justify-between items-center py-1.5 border-b border-subtle">
                  <span className="text-muted">
                    Home Improvements
                    <ExternalLink
                      href="/house"
                      label="Manage on House page"
                    />
                  </span>
                  <span className="font-medium">
                    {formatCurrency(current.homeImprovements)}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center py-1 text-xs text-faint">
                <span>Equity</span>
                <span className="font-medium text-secondary">
                  {formatCurrency(current.houseEquity)}
                </span>
              </div>
            </div>
          )}

          {/* Other Assets section */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <h4 className="text-xs font-semibold text-faint uppercase tracking-wide">
                Other Assets
              </h4>
              <button
                onClick={() => setAddingAsset(!addingAsset)}
                className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
              >
                {addingAsset ? "Cancel" : "+ Add"}
              </button>
            </div>

            {current.otherAssetItems.length === 0 && !addingAsset && (
              <p className="text-faint text-xs italic py-2">
                No other assets tracked. Click &quot;+ Add&quot; to track vehicles, jewelry, or other valuables.
              </p>
            )}

            {current.otherAssetItems.map((item) => (
              <div
                key={item.name}
                className="group flex justify-between items-center py-1.5 border-b border-subtle"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-muted">
                    {item.name}
                    {item.synced && <SyncBadge source={apiLabel} />}
                  </span>
                  {item.note && !item.synced && (
                    <p className="text-[10px] text-faint truncate">
                      {item.note}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {item.synced ? (
                    <span className="font-medium">
                      {formatCurrency(item.value)}
                    </span>
                  ) : (
                    <InlineEdit
                      value={String(item.value)}
                      onSave={(v) =>
                        upsertOAMutation.mutate({
                          name: item.name,
                          year: currentYear,
                          value: Number(v),
                        })
                      }
                      formatDisplay={(v) => formatCurrency(Number(v))}
                      parseInput={(v) => v.replace(/[^0-9.-]/g, "")}
                      type="number"
                      className="font-medium"
                    />
                  )}
                  {!item.synced && (
                    <button
                      onClick={() =>
                        deleteOAMutation.mutate({ id: item.id })
                      }
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-red-600 transition-all"
                      title="Remove asset"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Add form */}
            {addingAsset && (
              <div className="flex items-center gap-2 py-2 border-t mt-1">
                <input
                  type="text"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  placeholder="Asset name"
                  className="flex-1 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                  autoFocus
                />
                <input
                  type="number"
                  value={newAssetValue}
                  onChange={(e) => setNewAssetValue(e.target.value)}
                  placeholder="Value"
                  className="w-24 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
                <Button
                  size="xs"
                  onClick={() => {
                    if (newAssetName.trim() && newAssetValue) {
                      upsertOAMutation.mutate({
                        name: newAssetName.trim(),
                        year: currentYear,
                        value: Number(newAssetValue),
                      });
                    }
                  }}
                  disabled={!newAssetName.trim() || !newAssetValue}
                >
                  Save
                </Button>
              </div>
            )}

            {current.otherAssetItems.length > 0 && (
              <div className="flex justify-between items-center py-1 text-xs text-faint">
                <span>Subtotal</span>
                <span className="font-medium text-secondary">
                  {formatCurrency(current.otherAssetsTotal)}
                </span>
              </div>
            )}
          </div>

          {/* Grand total */}
          <div className="flex justify-between items-center py-2 border-t-2 border-strong font-semibold">
            <span>Total Assets</span>
            <span>{formatCurrency(current.totalAssets)}</span>
          </div>
        </div>
      </Card>

      {/* Historical Snapshots — open by default, filtered to non-empty years */}
      <Card
        title={
          <>
            Historical Snapshots{" "}
            <HelpTip text="Year-end asset values. The current year updates automatically from your live data. Past years are frozen snapshots." />
          </>
        }
        collapsible
        defaultOpen
        className="mb-6"
      >
        <p className="text-xs text-faint mb-3">
          Each row is a year-end snapshot. The current year reflects live values; previous years are frozen at their Dec 31 totals.
          {apiLabel && (
            <>
              {" "}
              Cash and synced assets update automatically from{" "}
              {apiLabel.toUpperCase()}.
            </>
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap border-collapse">
            <thead>
              <tr className="border-b">
                <StickyLeftHeader offset={0} borderRight>
                  Year
                </StickyLeftHeader>
                <ColHeader border>Cash</ColHeader>
                {hasHouse && <ColHeader>House Value</ColHeader>}
                {hasHouse && <ColHeader>Home Imp</ColHeader>}
                <ColHeader>Other Assets</ColHeader>
                <ColHeader>Total</ColHeader>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.year}
                  className={`border-b border-subtle hover:bg-surface-sunken/50 ${
                    row.isCurrent ? "bg-blue-50/30" : ""
                  }`}
                >
                  <StickyLeftCell offset={0} borderRight>
                    <span className="font-medium">{row.year}</span>
                    {row.isCurrent && (
                      <span className="ml-1 text-[10px] font-medium text-blue-600 bg-blue-50 px-1 py-0.5 rounded">
                        Live
                      </span>
                    )}
                  </StickyLeftCell>
                  <NumCell value={row.cash} border />
                  {hasHouse && <NumCell value={row.houseValue} />}
                  {hasHouse && <NumCell value={row.homeImprovements} />}
                  <NumCell value={row.otherAssets} />
                  <NumCell value={row.totalAssets} bold />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
