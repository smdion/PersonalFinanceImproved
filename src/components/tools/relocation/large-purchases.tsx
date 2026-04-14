"use client";

/** Large purchases panel (KPI summary + list + add form) for the Relocation
 *  calculator. Extracted from tools/page.tsx during the v0.5.2 file-split
 *  refactor. Stateless — all state flows via props.
 */

import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { LargePurchaseRow, RelocationResult } from "./types";

export type PurchaseFormState = {
  name: string;
  purchasePrice: string;
  purchaseYear: string;
  financed: boolean;
  downPaymentPercent: string;
  loanRate: string;
  loanTermYears: string;
  ongoingMonthlyCost: string;
  saleProceeds: string;
};

type Props = {
  result: RelocationResult;
  relocLargePurchases: LargePurchaseRow[];
  setRelocLargePurchases: React.Dispatch<
    React.SetStateAction<LargePurchaseRow[]>
  >;
  showPurchaseForm: boolean;
  setShowPurchaseForm: React.Dispatch<React.SetStateAction<boolean>>;
  purchaseForm: PurchaseFormState;
  setPurchaseForm: React.Dispatch<React.SetStateAction<PurchaseFormState>>;
};

export function RelocationLargePurchases({
  result: r,
  relocLargePurchases,
  setRelocLargePurchases,
  showPurchaseForm,
  setShowPurchaseForm,
  purchaseForm,
  setPurchaseForm,
}: Props) {
  return (
    <>
      {/* Large purchase summary KPIs (only when purchases exist) */}
      {relocLargePurchases.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-xs text-muted uppercase">
              Portfolio Hit from Purchases
              <HelpTip text="Total one-time cash withdrawn from portfolio for down payments, minus any sale proceeds" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              {r.totalLargePurchasePortfolioHit > 0 ? "−" : "+"}
              {formatCurrency(Math.abs(r.totalLargePurchasePortfolioHit))}
            </div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-xs text-muted uppercase">
              Monthly Cost from Purchases
              <HelpTip text="Steady-state monthly loan payments + ongoing costs from all purchases" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              +{formatCurrency(r.steadyStateMonthlyFromPurchases)}/mo
            </div>
          </div>
          <div className="bg-orange-50 rounded-lg p-3">
            <div className="text-xs text-muted uppercase">
              Annual from Purchases
              <HelpTip text="Total annualized cost from loan payments + ongoing costs, added to relocation expenses" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              +{formatCurrency(r.steadyStateMonthlyFromPurchases * 12)}/yr
            </div>
            <div className="text-xs text-faint">
              added to relocation expenses
            </div>
          </div>
        </div>
      )}

      {/* Large purchases list + add form */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-secondary">
            Large Purchases
            <HelpTip text="One-time purchases tied to the relocation — home, car, furniture, etc. Cash portion is withdrawn from portfolio; financed portions add monthly payments to expenses." />
          </h4>
          <button
            className="text-xs text-blue-600 hover:underline"
            onClick={() => setShowPurchaseForm(!showPurchaseForm)}
          >
            {showPurchaseForm ? "Cancel" : "+ Add Purchase"}
          </button>
        </div>

        {relocLargePurchases.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {relocLargePurchases.map((p) => {
              const isFinanced =
                p.downPaymentPercent !== undefined && p.downPaymentPercent < 1;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-1 bg-orange-50 text-orange-700 rounded px-2 py-1 text-xs"
                >
                  <span className="font-medium">{p.name}</span>
                  <span>
                    {formatCurrency(p.purchasePrice)} in {p.purchaseYear}
                  </span>
                  {isFinanced && (
                    <span className="text-orange-400">
                      ({formatPercent(p.downPaymentPercent ?? 0)} down,{" "}
                      {p.loanTermYears}yr @{formatPercent(p.loanRate ?? 0, 1)})
                    </span>
                  )}
                  {(p.ongoingMonthlyCost ?? 0) > 0 && (
                    <span className="text-orange-400">
                      +{formatCurrency(p.ongoingMonthlyCost!)}/mo
                    </span>
                  )}
                  {(p.saleProceeds ?? 0) > 0 && (
                    <span className="text-green-600">
                      +{formatCurrency(p.saleProceeds!)} proceeds
                    </span>
                  )}
                  <button
                    className="ml-1 text-orange-400 hover:text-red-600"
                    onClick={() =>
                      setRelocLargePurchases((prev) =>
                        prev.filter((x) => x.id !== p.id),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {showPurchaseForm && (
          <div className="bg-surface-sunken rounded-lg p-3 mb-2 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-muted">Name</label>
                <input
                  type="text"
                  className="border rounded px-2 py-1 w-full text-sm"
                  placeholder="e.g. New Home"
                  value={purchaseForm.name}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-muted">
                  Purchase Price ($)
                </label>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full text-sm"
                  placeholder="e.g. 500000"
                  value={purchaseForm.purchasePrice}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({
                      ...f,
                      purchasePrice: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-muted">
                  Purchase Year
                </label>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full text-sm"
                  value={purchaseForm.purchaseYear}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({
                      ...f,
                      purchaseYear: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={purchaseForm.financed}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({
                      ...f,
                      financed: e.target.checked,
                    }))
                  }
                />
                Financed
              </label>
            </div>

            {purchaseForm.financed && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-muted">
                    Down Payment %
                  </label>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-full text-sm"
                    value={purchaseForm.downPaymentPercent}
                    onChange={(e) =>
                      setPurchaseForm((f) => ({
                        ...f,
                        downPaymentPercent: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted">
                    Loan Rate %
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    className="border rounded px-2 py-1 w-full text-sm"
                    value={purchaseForm.loanRate}
                    onChange={(e) =>
                      setPurchaseForm((f) => ({
                        ...f,
                        loanRate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted">
                    Loan Term (years)
                  </label>
                  <input
                    type="number"
                    className="border rounded px-2 py-1 w-full text-sm"
                    value={purchaseForm.loanTermYears}
                    onChange={(e) =>
                      setPurchaseForm((f) => ({
                        ...f,
                        loanTermYears: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted">
                  Ongoing Monthly Cost ($)
                  <HelpTip text="Property tax, HOA, insurance, maintenance — any recurring monthly cost from this purchase" />
                </label>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full text-sm"
                  placeholder="0"
                  value={purchaseForm.ongoingMonthlyCost}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({
                      ...f,
                      ongoingMonthlyCost: e.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="block text-xs text-muted">
                  Sale Proceeds ($)
                  <HelpTip text="Net proceeds from selling an existing asset (e.g. current home equity minus closing costs). Offsets the cash outlay." />
                </label>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full text-sm"
                  placeholder="0"
                  value={purchaseForm.saleProceeds}
                  onChange={(e) =>
                    setPurchaseForm((f) => ({
                      ...f,
                      saleProceeds: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <Button
              size="xs"
              onClick={() => {
                const price = parseFloat(purchaseForm.purchasePrice);
                const year = parseInt(purchaseForm.purchaseYear);
                if (
                  !purchaseForm.name ||
                  isNaN(price) ||
                  price <= 0 ||
                  isNaN(year)
                )
                  return;

                const purchase: LargePurchaseRow = {
                  id: crypto.randomUUID(),
                  name: purchaseForm.name,
                  purchasePrice: price,
                  purchaseYear: year,
                };

                if (purchaseForm.financed) {
                  purchase.downPaymentPercent =
                    (parseFloat(purchaseForm.downPaymentPercent) || 20) / 100;
                  purchase.loanRate =
                    (parseFloat(purchaseForm.loanRate) || 6.5) / 100;
                  purchase.loanTermYears =
                    parseInt(purchaseForm.loanTermYears) || 30;
                }

                const ongoing = parseFloat(purchaseForm.ongoingMonthlyCost);
                if (!isNaN(ongoing) && ongoing > 0)
                  purchase.ongoingMonthlyCost = ongoing;

                const proceeds = parseFloat(purchaseForm.saleProceeds);
                if (!isNaN(proceeds) && proceeds > 0)
                  purchase.saleProceeds = proceeds;

                setRelocLargePurchases((prev) =>
                  [...prev, purchase].sort(
                    (a, b) => a.purchaseYear - b.purchaseYear,
                  ),
                );
                setPurchaseForm({
                  name: "",
                  purchasePrice: "",
                  purchaseYear: String(year),
                  financed: false,
                  downPaymentPercent: "20",
                  loanRate: "6.5",
                  loanTermYears: "30",
                  ongoingMonthlyCost: "",
                  saleProceeds: "",
                });
                setShowPurchaseForm(false);
              }}
            >
              Add Purchase
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
