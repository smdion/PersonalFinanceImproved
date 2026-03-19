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

  // Historical table
  const sorted = [...history].sort((a, b) => b.year - a.year);

  return (
    <div>
      <PageHeader title="Assets" />

      {/* Summary cards */}
      <div
        className={`grid grid-cols-1 ${hasHouse ? "md:grid-cols-3" : "md:grid-cols-2"} gap-4 mb-6`}
      >
        <Card
          title={
            <>
              Total Assets{" "}
              <HelpTip text="Sum of cash, house value, and other assets (excludes portfolio)" />
            </>
          }
        >
          <Metric
            value={formatCurrency(current.totalAssets)}
            label={`${currentYear} (YTD)`}
          />
        </Card>
        {hasHouse ? (
          <>
            <Card
              title={
                <>
                  House Equity{" "}
                  <HelpTip text="House value minus outstanding mortgage balance" />
                </>
              }
            >
              <Metric
                value={formatCurrency(current.houseEquity)}
                label="Current estimate"
                trend={{
                  value: formatCurrency(current.houseEquity),
                  positive: current.houseEquity >= 0,
                }}
              />
            </Card>
            <Card
              title={
                <>
                  House{" "}
                  <HelpTip text="Home value, property taxes, and improvements — managed on the House page" />
                </>
              }
              href="/house"
            >
              <Metric
                value={formatCurrency(current.houseEquity)}
                label="Equity"
              />
            </Card>
          </>
        ) : (
          <Card title="Cash & Other">
            <Metric
              value={formatCurrency(current.cash + current.otherAssetsTotal)}
              label={`Cash: ${formatCurrency(current.cash)}`}
            />
          </Card>
        )}
      </div>

      {/* Cash & Property + Other Assets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Cash & Property */}
        <Card title="Cash & Property">
          <div className="space-y-2 text-sm">
            {/* Cash */}
            <div className="flex justify-between items-center py-1 border-b border-subtle">
              <span className="text-muted">
                Cash
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

            {/* House Value — only show when house data exists */}
            {hasHouse && (
              <div className="flex justify-between items-center py-1 border-b border-subtle">
                <span className="text-muted">
                  House Value
                  {current.houseValueSynced && <SyncBadge source={apiLabel} />}
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
            )}

            {/* Mortgage Balance — only show when house data exists */}
            {hasHouse && (
              <>
                <div className="flex justify-between items-center py-1 border-b border-subtle">
                  <span className="text-muted">
                    Mortgage Balance
                    {current.mortgageSynced && <SyncBadge source={apiLabel} />}
                    <Link
                      href="/liabilities"
                      className="ml-1.5 text-blue-600 hover:text-blue-700 text-[10px]"
                      title="Manage on Liabilities page"
                    >
                      <svg
                        className="w-3 h-3 inline"
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
                  <span className="font-medium text-red-600">
                    -{formatCurrency(current.mortgageBalance)}
                  </span>
                </div>

                {/* House Equity */}
                <div className="flex justify-between py-1 font-semibold">
                  <span>House Equity</span>
                  <span
                    className={
                      current.houseEquity >= 0
                        ? "text-green-700"
                        : "text-red-600"
                    }
                  >
                    {formatCurrency(current.houseEquity)}
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Other Assets */}
        <Card
          title={
            <>
              Other Assets{" "}
              <HelpTip text="Non-portfolio assets like vehicles, jewelry, retirement accounts outside your portfolio" />
            </>
          }
          headerRight={
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-secondary">
                {formatCurrency(current.otherAssetsTotal)}
              </span>
              <button
                onClick={() => setAddingAsset(!addingAsset)}
                className="px-2 py-0.5 text-[10px] font-medium rounded bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition-colors"
              >
                {addingAsset ? "Cancel" : "+ Add"}
              </button>
            </div>
          }
        >
          <div className="space-y-1 text-sm">
            {current.otherAssetItems.length === 0 && !addingAsset && (
              <p className="text-faint text-xs italic py-2">
                No other assets tracked yet.
              </p>
            )}
            {current.otherAssetItems.map((item) => (
              <div
                key={item.name}
                className="group flex justify-between items-center py-1 border-b border-subtle"
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
                      onClick={() => deleteOAMutation.mutate({ id: item.id })}
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

            {/* Total */}
            {current.otherAssetItems.length > 0 && (
              <div className="flex justify-between py-1 font-semibold pt-1">
                <span>Total</span>
                <span>{formatCurrency(current.otherAssetsTotal)}</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Historical Snapshots */}
      <Card
        title="Historical Snapshots"
        collapsible
        defaultOpen={false}
        className="mb-6"
      >
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
                        YTD
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
