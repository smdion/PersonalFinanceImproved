"use client";

/** Client content for the Assets page — prefetched by page.tsx. */

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
import { SyncBadge } from "@/components/ui/sync-badge";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import Link from "next/link";

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-caption ml-1.5 inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-700"
      title={label}
    >
      <svg
        aria-hidden="true"
        className="h-3 w-3"
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

export function AssetsContent() {
  const targeting = useYearEndTargetingInput();
  const { data, isLoading, error } =
    trpc.assets.computeSummary.useQuery(targeting);
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
      <p className="text-sm text-red-600">
        Failed to load asset data: {error.message}
      </p>
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

  const { current } = data;
  const currentYear = new Date().getFullYear();
  const hasHouse = current.hasHouse;
  const apiLabel =
    current.activeBudgetApi !== "none" ? current.activeBudgetApi : "";

  return (
    <div>
      <PageHeader title="Assets" />

      {/* Summary cards — headline metrics only, no detail duplication */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
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
              Cash <HelpTip text="Liquid cash across all on-budget accounts" />
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
            <h4 className="text-faint mb-1 text-xs font-semibold tracking-wide uppercase">
              Cash
            </h4>
            <div className="border-subtle flex items-center justify-between border-b py-1.5">
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
              <h4 className="text-faint mb-1 text-xs font-semibold tracking-wide uppercase">
                Property
                <ExternalLink href="/house" label="Manage on House page" />
              </h4>
              <div className="border-subtle flex items-center justify-between border-b py-1.5">
                <span className="text-muted">
                  Home Value
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
              <div className="border-subtle flex items-center justify-between border-b py-1.5">
                <span className="text-muted">
                  Mortgage Balance
                  {current.mortgageSynced && <SyncBadge source={apiLabel} />}
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
                <div className="border-subtle flex items-center justify-between border-b py-1.5">
                  <span className="text-muted">
                    Home Improvements
                    <ExternalLink href="/house" label="Manage on House page" />
                  </span>
                  <span className="font-medium">
                    {formatCurrency(current.homeImprovements)}
                  </span>
                </div>
              )}
              <div className="text-faint flex items-center justify-between py-1 text-xs">
                <span>Equity</span>
                <span className="text-secondary font-medium">
                  {formatCurrency(current.houseEquity)}
                </span>
              </div>
            </div>
          )}

          {/* Other Assets section */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-faint text-xs font-semibold tracking-wide uppercase">
                Other Assets
              </h4>
              <button
                onClick={() => setAddingAsset(!addingAsset)}
                className="text-caption rounded border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-blue-600 transition-colors hover:bg-blue-100"
              >
                {addingAsset ? "Cancel" : "+ Add"}
              </button>
            </div>

            {current.otherAssetItems.length === 0 && !addingAsset && (
              <p className="text-faint py-2 text-xs italic">
                No other assets tracked. Click &quot;+ Add&quot; to track
                vehicles, jewelry, or other valuables.
              </p>
            )}

            {current.otherAssetItems.map((item) => (
              <div
                key={item.id ?? item.name}
                className="group border-subtle flex items-center justify-between border-b py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-muted">
                    {item.name}
                    {item.synced && <SyncBadge source={apiLabel} />}
                  </span>
                  {item.note && !item.synced && (
                    <p className="text-caption text-faint truncate">
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
                      className="text-faint p-0.5 transition-all hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                      title="Remove asset"
                    >
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
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
              <div className="mt-1 flex items-center gap-2 border-t py-2">
                <input
                  type="text"
                  value={newAssetName}
                  onChange={(e) => setNewAssetName(e.target.value)}
                  placeholder="Asset name"
                  className="border-strong bg-surface-primary flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                  autoFocus
                />
                <input
                  type="number"
                  value={newAssetValue}
                  onChange={(e) => setNewAssetValue(e.target.value)}
                  placeholder="Value"
                  className="border-strong bg-surface-primary w-24 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
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
              <div className="text-faint flex items-center justify-between py-1 text-xs">
                <span>Subtotal</span>
                <span className="text-secondary font-medium">
                  {formatCurrency(current.otherAssetsTotal)}
                </span>
              </div>
            )}
          </div>

          {/* Grand total */}
          <div className="border-strong flex items-center justify-between border-t-2 py-2 font-semibold">
            <span>Total Assets</span>
            <span>{formatCurrency(current.totalAssets)}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
