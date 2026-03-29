"use client";

/** Displays home value, improvement history, and equity estimates with links to the liabilities page for mortgage context. */

import { useState } from "react";
import { Skeleton, SkeletonChart } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { Card, Metric } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";

function SyncBadge({ source }: { source: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
      Synced from {source.toUpperCase()}
    </span>
  );
}

export default function HousePage() {
  const { data: assetData, isLoading: assetsLoading } =
    trpc.assets.computeSummary.useQuery();
  const { data: mortgageData, isLoading: mortgageLoading } =
    trpc.mortgage.computeActiveSummary.useQuery();
  const { data: propTaxes, isLoading: taxesLoading } =
    trpc.assets.listPropertyTaxes.useQuery();
  const utils = trpc.useUtils();

  // Home improvement form state
  const [addingHI, setAddingHI] = useState(false);
  const [newHIYear, setNewHIYear] = useState(String(new Date().getFullYear()));
  const [newHIDesc, setNewHIDesc] = useState("");
  const [newHICost, setNewHICost] = useState("");
  const [editingHI, setEditingHI] = useState<number | null>(null);
  const [editHIDesc, setEditHIDesc] = useState("");
  const [editHICost, setEditHICost] = useState("");

  // Property tax form state
  const [addingTax, setAddingTax] = useState(false);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [taxAssessed, setTaxAssessed] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [editingTax, setEditingTax] = useState<number | null>(null);
  const [editTaxAssessed, setEditTaxAssessed] = useState("");
  const [editTaxAmount, setEditTaxAmount] = useState("");
  const [editTaxNote, setEditTaxNote] = useState("");

  const invalidateAll = () => {
    utils.assets.invalidate();
    utils.mortgage.invalidate();
    utils.historical.invalidate();
    utils.networth.invalidate();
  };

  const addHIMutation = trpc.assets.addHomeImprovement.useMutation({
    onSuccess: () => {
      invalidateAll();
      setAddingHI(false);
      setNewHIDesc("");
      setNewHICost("");
    },
  });
  const deleteHIMutation = trpc.assets.deleteHomeImprovement.useMutation({
    onSuccess: invalidateAll,
  });
  const updateHIMutation = trpc.assets.updateHomeImprovement.useMutation({
    onSuccess: () => {
      invalidateAll();
      setEditingHI(null);
    },
  });
  const upsertTaxMutation = trpc.assets.upsertPropertyTax.useMutation({
    onSuccess: () => {
      invalidateAll();
      setAddingTax(false);
      setEditingTax(null);
      setTaxAssessed("");
      setTaxAmount("");
      setTaxNote("");
    },
  });
  const deleteTaxMutation = trpc.assets.deletePropertyTax.useMutation({
    onSuccess: invalidateAll,
  });

  const isLoading = assetsLoading || mortgageLoading || taxesLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <SkeletonChart key={i} height={112} />
          ))}
        </div>
        <SkeletonChart height={256} />
      </div>
    );
  }

  const current = assetData?.current;
  const activeLoan =
    mortgageData?.loans?.find((l) => l.isActive) ?? mortgageData?.loans?.[0];
  const loanResult = activeLoan
    ? (mortgageData?.result?.loans?.find((r) => r.loanId === activeLoan.id) ??
      mortgageData?.result?.loans?.[0])
    : mortgageData?.result?.loans?.[0];
  const homeImprovements = assetData?.homeImprovements ?? [];

  // Group home improvements by year
  const hiByYear = new Map<number, typeof homeImprovements>();
  for (const hi of homeImprovements) {
    const items = hiByYear.get(hi.year) ?? [];
    items.push(hi);
    hiByYear.set(hi.year, items);
  }
  const hiYears = Array.from(hiByYear.keys()).sort((a, b) => b - a);
  const hiTotal = homeImprovements.reduce((s, hi) => s + hi.cost, 0);

  // Get the loan ID for property tax upsert
  const loanId = activeLoan?.id;

  // Use the server-side hasHouse flag (accounts for mortgage loans + improvements)
  const hasAnyData = assetData?.current?.hasHouse ?? false;

  if (!hasAnyData) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="House"
          subtitle="Home value, mortgage summary, property taxes, and improvements"
        />
        <Card>
          <div className="text-center py-12">
            <p className="text-muted">No house data yet</p>
            <p className="text-sm text-faint mt-2">
              Add a mortgage on the{" "}
              <Link
                href="/liabilities"
                className="text-blue-600 hover:underline"
              >
                Liabilities
              </Link>{" "}
              page, or record home improvements below to get started.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="House"
        subtitle="Home value, mortgage summary, property taxes, and improvements"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          title={
            <>
              Home Value{" "}
              {current?.houseValueSynced && <SyncBadge source="ynab" />}
            </>
          }
        >
          <Metric
            value={formatCurrency(current?.houseValue ?? 0)}
            label={
              activeLoan
                ? `Purchase: ${formatCurrency(Number(activeLoan.propertyValuePurchase))}`
                : undefined
            }
          />
        </Card>

        <Card title="Mortgage Balance">
          <Metric
            value={formatCurrency(loanResult?.currentBalance ?? 0)}
            label={
              loanResult?.apiBalance != null &&
              loanResult.calculatedBalance != null
                ? `Calculated: ${formatCurrency(loanResult.calculatedBalance)}`
                : undefined
            }
          />
          {loanResult?.apiBalance != null && <SyncBadge source="ynab" />}
        </Card>

        <Card title="Equity">
          <Metric
            value={formatCurrency(
              (current?.houseValue ?? 0) - (loanResult?.currentBalance ?? 0),
            )}
            label={
              loanResult
                ? `${formatPercent(1 - loanResult.currentBalance / (current?.houseValue ?? 1), 1)} equity`
                : undefined
            }
          />
        </Card>

        <Card title="Home Improvements">
          <Metric
            value={formatCurrency(hiTotal)}
            label={`${homeImprovements.length} items`}
          />
        </Card>
      </div>

      {/* Mortgage Summary */}
      {loanResult && activeLoan && (
        <Card
          title={
            <span className="flex items-center gap-2">
              Mortgage Summary
              <HelpTip text="Basic mortgage info. Full amortization detail on the Liabilities page." />
            </span>
          }
          headerRight={
            <Link
              href="/liabilities"
              className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
            >
              Full detail →
            </Link>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted">Loan</div>
              <div className="font-medium">{activeLoan.name}</div>
            </div>
            <div>
              <div className="text-muted">Rate</div>
              <div className="font-medium">
                {formatPercent(Number(activeLoan.interestRate), 3)}
              </div>
            </div>
            <div>
              <div className="text-muted">Monthly P&I</div>
              <div className="font-medium">
                {formatCurrency(Number(activeLoan.principalAndInterest))}
              </div>
            </div>
            <div>
              <div className="text-muted">Remaining</div>
              <div className="font-medium">
                {loanResult.remainingMonths} months
              </div>
            </div>
            <div>
              <div className="text-muted">Payoff Date</div>
              <div className="font-medium">
                {new Date(loanResult.payoffDate).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })}
              </div>
            </div>
            <div>
              <div className="text-muted">Ahead of Schedule</div>
              <div className="font-medium text-green-600">
                {loanResult.monthsAheadOfSchedule > 0
                  ? `${loanResult.monthsAheadOfSchedule} months`
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted">Interest Saved</div>
              <div className="font-medium text-green-600">
                {loanResult.totalInterestSaved > 0
                  ? formatCurrency(loanResult.totalInterestSaved)
                  : "—"}
              </div>
            </div>
            <div>
              <div className="text-muted">Paid Off</div>
              <div className="font-medium">
                {formatPercent(loanResult.payoffPercent, 1)}
              </div>
            </div>
          </div>
          {loanResult.apiBalance != null &&
            loanResult.calculatedBalance != null && (
              <div className="mt-3 p-2 bg-blue-50 rounded text-xs text-blue-700">
                YNAB balance: {formatCurrency(loanResult.apiBalance)} |
                Calculated: {formatCurrency(loanResult.calculatedBalance)} |
                Diff:{" "}
                {formatCurrency(
                  Math.abs(
                    loanResult.apiBalance - loanResult.calculatedBalance,
                  ),
                )}
              </div>
            )}
        </Card>
      )}

      {/* Property Taxes */}
      <Card
        title="Property Taxes"
        headerRight={
          loanId && (
            <button
              onClick={() => setAddingTax((p) => !p)}
              className="px-2 py-1 text-[10px] font-medium rounded bg-surface-elevated text-muted hover:bg-surface-strong transition-colors"
            >
              {addingTax ? "Cancel" : "+ Add"}
            </button>
          )
        }
      >
        {addingTax && loanId && (
          <div className="flex items-center gap-2 py-2 border-b mb-2">
            <input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className="w-16 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="Year"
            />
            <input
              type="number"
              value={taxAssessed}
              onChange={(e) => setTaxAssessed(e.target.value)}
              placeholder="Assessed Value"
              className="w-28 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <input
              type="number"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              placeholder="Tax Amount"
              className="w-24 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
              autoFocus
            />
            <input
              type="text"
              value={taxNote}
              onChange={(e) => setTaxNote(e.target.value)}
              placeholder="Note"
              className="flex-1 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <Button
              size="xs"
              onClick={() => {
                if (taxAmount && taxYear) {
                  upsertTaxMutation.mutate({
                    loanId,
                    year: Number(taxYear),
                    assessedValue: taxAssessed ? Number(taxAssessed) : null,
                    taxAmount: Number(taxAmount),
                    note: taxNote || null,
                  });
                }
              }}
              disabled={!taxAmount || !taxYear}
            >
              Save
            </Button>
          </div>
        )}

        {!propTaxes || propTaxes.length === 0 ? (
          <p className="text-sm text-faint">
            {loanId
              ? "No property tax records yet."
              : "No active mortgage loan."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b">
                <th className="py-1 font-medium">Year</th>
                <th className="py-1 font-medium text-right">Assessed Value</th>
                <th className="py-1 font-medium text-right">Tax Amount</th>
                <th className="py-1 font-medium text-right">Eff. Rate</th>
                <th className="py-1 font-medium">Note</th>
                <th className="py-1 w-8" />
              </tr>
            </thead>
            <tbody>
              {propTaxes.map((pt) =>
                editingTax === pt.id ? (
                  <tr
                    key={pt.id}
                    className="border-b border-subtle bg-blue-50/30"
                  >
                    <td className="py-1.5 font-medium">{pt.year}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        value={editTaxAssessed}
                        onChange={(e) => setEditTaxAssessed(e.target.value)}
                        className="w-28 px-2 py-0.5 text-xs text-right border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                        placeholder="Assessed Value"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        value={editTaxAmount}
                        onChange={(e) => setEditTaxAmount(e.target.value)}
                        className="w-24 px-2 py-0.5 text-xs text-right border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                        autoFocus
                      />
                    </td>
                    <td className="py-1.5" />
                    <td className="py-1.5">
                      <input
                        type="text"
                        value={editTaxNote}
                        onChange={(e) => setEditTaxNote(e.target.value)}
                        className="w-full px-2 py-0.5 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                        placeholder="Note"
                      />
                    </td>
                    <td className="py-1.5 whitespace-nowrap">
                      <Button
                        size="xs"
                        onClick={() => {
                          if (editTaxAmount && loanId) {
                            upsertTaxMutation.mutate({
                              loanId,
                              year: pt.year,
                              assessedValue: editTaxAssessed
                                ? Number(editTaxAssessed)
                                : null,
                              taxAmount: Number(editTaxAmount),
                              note: editTaxNote || null,
                            });
                          }
                        }}
                        disabled={!editTaxAmount}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingTax(null)}
                        className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-surface-elevated text-muted hover:bg-surface-strong transition-colors"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={pt.id}
                    className="group border-b border-subtle hover:bg-surface-sunken cursor-pointer"
                    onClick={() => {
                      setEditingTax(pt.id);
                      setEditTaxAssessed(
                        pt.assessedValue != null
                          ? String(pt.assessedValue)
                          : "",
                      );
                      setEditTaxAmount(String(pt.taxAmount));
                      setEditTaxNote(pt.note ?? "");
                    }}
                  >
                    <td className="py-1.5 font-medium">{pt.year}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {pt.assessedValue != null
                        ? formatCurrency(pt.assessedValue)
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-medium">
                      {formatCurrency(pt.taxAmount)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted">
                      {pt.assessedValue != null && pt.assessedValue > 0
                        ? formatPercent(pt.taxAmount / pt.assessedValue, 2)
                        : "—"}
                    </td>
                    <td className="py-1.5 text-muted text-xs truncate max-w-[120px]">
                      {pt.note ?? ""}
                    </td>
                    <td className="py-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTaxMutation.mutate({ id: pt.id });
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-red-600 transition-all"
                        title="Delete"
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
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Home Improvements */}
      <Card
        title={
          <>
            Home Improvements{" "}
            <span className="text-xs font-normal text-faint ml-1">
              ({formatCurrency(hiTotal)} total)
            </span>
          </>
        }
        headerRight={
          <button
            onClick={() => setAddingHI((p) => !p)}
            className="px-2 py-1 text-[10px] font-medium rounded bg-surface-elevated text-muted hover:bg-surface-strong transition-colors"
          >
            {addingHI ? "Cancel" : "+ Add"}
          </button>
        }
      >
        {addingHI && (
          <div className="flex items-center gap-2 py-2 border-b mb-2">
            <input
              type="number"
              value={newHIYear}
              onChange={(e) => setNewHIYear(e.target.value)}
              className="w-16 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="Year"
            />
            <input
              type="text"
              value={newHIDesc}
              onChange={(e) => setNewHIDesc(e.target.value)}
              placeholder="Description"
              className="flex-1 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
              autoFocus
            />
            <input
              type="number"
              value={newHICost}
              onChange={(e) => setNewHICost(e.target.value)}
              placeholder="Cost"
              className="w-24 px-2 py-1 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
            <Button
              size="xs"
              onClick={() => {
                if (newHIDesc.trim() && newHICost && newHIYear) {
                  addHIMutation.mutate({
                    year: Number(newHIYear),
                    description: newHIDesc.trim(),
                    cost: Number(newHICost),
                  });
                }
              }}
              disabled={!newHIDesc.trim() || !newHICost || !newHIYear}
            >
              Save
            </Button>
          </div>
        )}

        {hiYears.length === 0 ? (
          <p className="text-sm text-faint">No home improvements recorded.</p>
        ) : (
          hiYears.map((year) => {
            const items = hiByYear.get(year) ?? [];
            return (
              <div key={year}>
                <div className="text-xs font-medium text-faint mt-3 mb-1 first:mt-0">
                  {year}
                </div>
                {items.map((hi) =>
                  editingHI === hi.id ? (
                    <div
                      key={hi.id}
                      className="flex items-center gap-2 py-1 border-b border-subtle pl-3 bg-blue-50/30"
                    >
                      <input
                        type="text"
                        value={editHIDesc}
                        onChange={(e) => setEditHIDesc(e.target.value)}
                        className="flex-1 px-2 py-0.5 text-xs border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                        autoFocus
                      />
                      <input
                        type="number"
                        value={editHICost}
                        onChange={(e) => setEditHICost(e.target.value)}
                        className="w-24 px-2 py-0.5 text-xs text-right border border-strong rounded bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-300"
                      />
                      <Button
                        size="xs"
                        onClick={() => {
                          if (editHIDesc.trim() && editHICost) {
                            updateHIMutation.mutate({
                              id: hi.id,
                              description: editHIDesc.trim(),
                              cost: Number(editHICost),
                            });
                          }
                        }}
                        disabled={!editHIDesc.trim() || !editHICost}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingHI(null)}
                        className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-surface-elevated text-muted hover:bg-surface-strong transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      key={hi.id}
                      className="group flex justify-between items-center py-1 border-b border-subtle pl-3 cursor-pointer"
                      onClick={() => {
                        setEditingHI(hi.id);
                        setEditHIDesc(hi.description);
                        setEditHICost(String(hi.cost));
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-muted">{hi.description}</span>
                        {hi.note && (
                          <p className="text-[10px] text-faint truncate">
                            {hi.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-medium">
                          {formatCurrency(hi.cost)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHIMutation.mutate({ id: hi.id });
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-red-600 transition-all"
                          title="Delete"
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
                      </div>
                    </div>
                  ),
                )}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
}
