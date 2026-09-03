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
import { safeDivide } from "@/lib/utils/math";
import { Lock, LockOpen } from "lucide-react";
import { SyncBadge } from "@/components/ui/sync-badge";
import { useYearEndTargetingInput } from "@/lib/hooks/use-year-end-targeting";
import { useDraftCommit } from "@/lib/hooks/use-draft-commit";

export default function HousePage() {
  const targeting = useYearEndTargetingInput();
  const { data: assetData, isLoading: assetsLoading } =
    trpc.assets.computeSummary.useQuery(targeting);
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
  const { drafts: hiDraft, setDraft: setHIDraft } = useDraftCommit();

  // Property tax form state
  const [addingTax, setAddingTax] = useState(false);
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [taxAssessed, setTaxAssessed] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [taxNote, setTaxNote] = useState("");
  const [editingTax, setEditingTax] = useState<number | null>(null);
  const [taxLocked, setTaxLocked] = useState(true);
  const { drafts: taxDraft, setDraft: setTaxDraft } = useDraftCommit();

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <SkeletonChart key={i} height={112} />
          ))}
        </div>
        <SkeletonChart height={256} />
      </div>
    );
  }

  const current = assetData?.current;
  const activeLoan = mortgageData?.loans?.find(
    (l) => l.id === mortgageData?.activeLoanId,
  );
  const loanResult = mortgageData?.activeLoanResult ?? undefined;
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
          <div className="py-12 text-center">
            <p className="text-muted">No house data yet</p>
            <p className="text-faint mt-2 text-sm">
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                ? `${formatPercent(1 - safeDivide(loanResult.currentBalance, current?.houseValue ?? 0, 0)!, 1)} equity`
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
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
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
              <div className="mt-3 rounded bg-blue-50 p-2 text-xs text-blue-700">
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
          <span className="inline-flex items-center gap-2">
            <button
              onClick={() => setTaxLocked((l) => !l)}
              className="text-faint hover:text-primary p-1 transition-colors"
              title={taxLocked ? "Unlock to edit" : "Lock editing"}
            >
              {taxLocked ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <LockOpen className="h-3.5 w-3.5" />
              )}
            </button>
            {loanId && !taxLocked && (
              <button
                onClick={() => setAddingTax((p) => !p)}
                className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong rounded px-2 py-1 font-medium transition-colors"
              >
                {addingTax ? "Cancel" : "+ Add"}
              </button>
            )}
          </span>
        }
      >
        {addingTax && loanId && (
          <div className="mb-2 flex items-center gap-2 border-b py-2">
            <input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              className="border-strong bg-surface-primary w-16 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
              placeholder="Year"
            />
            <input
              type="number"
              value={taxAssessed}
              onChange={(e) => setTaxAssessed(e.target.value)}
              placeholder="Assessed Value"
              className="border-strong bg-surface-primary w-28 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
            />
            <input
              type="number"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              placeholder="Tax Amount"
              className="border-strong bg-surface-primary w-24 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
              autoFocus
            />
            <input
              type="text"
              value={taxNote}
              onChange={(e) => setTaxNote(e.target.value)}
              placeholder="Note"
              className="border-strong bg-surface-primary flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
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
          <p className="text-faint text-sm">
            {loanId
              ? "No property tax records yet."
              : "No active mortgage loan."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted border-b text-left">
                <th className="py-1 font-medium">Year</th>
                <th className="py-1 text-right font-medium">Assessed Value</th>
                <th className="py-1 text-right font-medium">Tax Amount</th>
                <th className="py-1 text-right font-medium">Eff. Rate</th>
                <th className="py-1 font-medium">Note</th>
                <th className="w-8 py-1" />
              </tr>
            </thead>
            <tbody>
              {propTaxes.map((pt) =>
                editingTax === pt.id ? (
                  <tr
                    key={pt.id}
                    className="border-subtle border-b bg-blue-50/30"
                  >
                    <td className="py-1.5 font-medium">{pt.year}</td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        value={taxDraft.assessed ?? ""}
                        onChange={(e) =>
                          setTaxDraft("assessed", e.target.value)
                        }
                        className="border-strong bg-surface-primary w-28 rounded border px-2 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                        placeholder="Assessed Value"
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <input
                        type="number"
                        value={taxDraft.amount ?? ""}
                        onChange={(e) => setTaxDraft("amount", e.target.value)}
                        className="border-strong bg-surface-primary w-24 rounded border px-2 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                        autoFocus
                      />
                    </td>
                    <td className="py-1.5" />
                    <td className="py-1.5">
                      <input
                        type="text"
                        value={taxDraft.note ?? ""}
                        onChange={(e) => setTaxDraft("note", e.target.value)}
                        className="border-strong bg-surface-primary w-full rounded border px-2 py-0.5 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                        placeholder="Note"
                      />
                    </td>
                    <td className="py-1.5 whitespace-nowrap">
                      <Button
                        size="xs"
                        onClick={() => {
                          const amount = taxDraft.amount ?? "";
                          if (amount && loanId) {
                            upsertTaxMutation.mutate({
                              loanId,
                              year: pt.year,
                              assessedValue: taxDraft.assessed
                                ? Number(taxDraft.assessed)
                                : null,
                              taxAmount: Number(amount),
                              note: taxDraft.note || null,
                            });
                          }
                        }}
                        disabled={!taxDraft.amount}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingTax(null)}
                        className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong ml-1 rounded px-1.5 py-0.5 font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={pt.id}
                    className={`group border-subtle hover:bg-surface-sunken border-b ${taxLocked ? "" : "cursor-pointer"}`}
                    onClick={() => {
                      if (taxLocked) return;
                      setEditingTax(pt.id);
                      setTaxDraft(
                        "assessed",
                        pt.assessedValue != null
                          ? String(pt.assessedValue)
                          : "",
                      );
                      setTaxDraft("amount", String(pt.taxAmount));
                      setTaxDraft("note", pt.note ?? "");
                    }}
                  >
                    <td className="py-1.5 font-medium">{pt.year}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {pt.assessedValue != null
                        ? formatCurrency(pt.assessedValue)
                        : "—"}
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">
                      {formatCurrency(pt.taxAmount)}
                    </td>
                    <td className="text-muted py-1.5 text-right tabular-nums">
                      {pt.assessedValue != null && pt.assessedValue > 0
                        ? formatPercent(
                            safeDivide(pt.taxAmount, pt.assessedValue, 0)!,
                            2,
                          )
                        : "—"}
                    </td>
                    <td className="text-muted max-w-[120px] truncate py-1.5 text-xs">
                      {pt.note ?? ""}
                    </td>
                    <td className="py-1.5">
                      {!taxLocked && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteTaxMutation.mutate({ id: pt.id });
                          }}
                          className="text-faint p-0.5 transition-all hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                          title="Delete"
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
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Utilities — lives in the Upkeep domain; linked here for convenience */}
      <Link href="/upkeep/utilities" className="block">
        <Card className="hover:bg-surface-sunken transition-colors">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Utilities</p>
              <p className="text-faint text-sm">
                Gas, water &amp; electric cost and usage history
              </p>
            </div>
            <span className="text-sm text-blue-600 hover:underline">
              View tracker →
            </span>
          </div>
        </Card>
      </Link>

      {/* Home Improvements */}
      <Card
        title={
          <>
            Home Improvements{" "}
            <span className="text-faint ml-1 text-xs font-normal">
              ({formatCurrency(hiTotal)} total)
            </span>
          </>
        }
        headerRight={
          <button
            onClick={() => setAddingHI((p) => !p)}
            className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong rounded px-2 py-1 font-medium transition-colors"
          >
            {addingHI ? "Cancel" : "+ Add"}
          </button>
        }
      >
        {addingHI && (
          <div className="mb-2 flex items-center gap-2 border-b py-2">
            <input
              type="number"
              value={newHIYear}
              onChange={(e) => setNewHIYear(e.target.value)}
              className="border-strong bg-surface-primary w-16 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
              placeholder="Year"
            />
            <input
              type="text"
              value={newHIDesc}
              onChange={(e) => setNewHIDesc(e.target.value)}
              placeholder="Description"
              className="border-strong bg-surface-primary flex-1 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
              autoFocus
            />
            <input
              type="number"
              value={newHICost}
              onChange={(e) => setNewHICost(e.target.value)}
              placeholder="Cost"
              className="border-strong bg-surface-primary w-24 rounded border px-2 py-1 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
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
          <p className="text-faint text-sm">No home improvements recorded.</p>
        ) : (
          hiYears.map((year) => {
            const items = hiByYear.get(year) ?? [];
            return (
              <div key={year}>
                <div className="text-faint mt-3 mb-1 text-xs font-medium first:mt-0">
                  {year}
                </div>
                {items.map((hi) =>
                  editingHI === hi.id ? (
                    <div
                      key={hi.id}
                      className="border-subtle flex items-center gap-2 border-b bg-blue-50/30 py-1 pl-3"
                    >
                      <input
                        type="text"
                        value={hiDraft.desc ?? ""}
                        onChange={(e) => setHIDraft("desc", e.target.value)}
                        className="border-strong bg-surface-primary flex-1 rounded border px-2 py-0.5 text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                        autoFocus
                      />
                      <input
                        type="number"
                        value={hiDraft.cost ?? ""}
                        onChange={(e) => setHIDraft("cost", e.target.value)}
                        className="border-strong bg-surface-primary w-24 rounded border px-2 py-0.5 text-right text-xs focus:ring-1 focus:ring-blue-300 focus:outline-none"
                      />
                      <Button
                        size="xs"
                        onClick={() => {
                          const desc = (hiDraft.desc ?? "").trim();
                          const cost = hiDraft.cost ?? "";
                          if (desc && cost) {
                            updateHIMutation.mutate({
                              id: hi.id,
                              description: desc,
                              cost: Number(cost),
                            });
                          }
                        }}
                        disabled={!(hiDraft.desc ?? "").trim() || !hiDraft.cost}
                      >
                        Save
                      </Button>
                      <button
                        onClick={() => setEditingHI(null)}
                        className="text-caption bg-surface-elevated text-muted hover:bg-surface-strong rounded px-1.5 py-0.5 font-medium transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div
                      key={hi.id}
                      className="group border-subtle flex cursor-pointer items-center justify-between border-b py-1 pl-3"
                      onClick={() => {
                        setEditingHI(hi.id);
                        setHIDraft("desc", hi.description);
                        setHIDraft("cost", String(hi.cost));
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-muted">{hi.description}</span>
                        {hi.note && (
                          <p className="text-caption text-faint truncate">
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
                          className="text-faint p-0.5 transition-all hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
                          title="Delete"
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
