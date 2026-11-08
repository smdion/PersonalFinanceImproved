"use client";

/** Large purchases panel (KPI summary + list + add form) for the Relocation
 *  calculator. Stateless — all state flows via props.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import {
  DEFAULT_LOAN_DOWN_PAYMENT_PERCENT,
  DEFAULT_LOAN_RATE,
  DEFAULT_LOAN_TERM_YEARS,
} from "@/lib/constants";
import type { LargePurchaseRow, RelocationResult } from "./types";
import {
  PurchaseBasicsFields,
  PurchaseCostFields,
  type PurchaseFormState,
} from "./large-purchase-fields";

export type { PurchaseFormState } from "./large-purchase-fields";

type Props = {
  result: RelocationResult;
  relocLargePurchases: LargePurchaseRow[];
  setRelocLargePurchases: React.Dispatch<
    React.SetStateAction<LargePurchaseRow[]>
  >;
  purchaseForm: PurchaseFormState;
  setPurchaseForm: React.Dispatch<React.SetStateAction<PurchaseFormState>>;
};

export function RelocationLargePurchases({
  result: r,
  relocLargePurchases,
  setRelocLargePurchases,
  purchaseForm,
  setPurchaseForm,
}: Props) {
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  return (
    <>
      {/* Large purchase summary KPIs (only when purchases exist) */}
      {relocLargePurchases.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-orange-50 p-3">
            <div className="text-muted text-xs uppercase">
              Portfolio Hit from Purchases
              <HelpTip text="Total one-time cash withdrawn from portfolio for down payments, minus any sale proceeds" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              {r.totalLargePurchasePortfolioHit > 0 ? "−" : "+"}
              {formatCurrency(Math.abs(r.totalLargePurchasePortfolioHit))}
            </div>
          </div>
          <div className="rounded-lg bg-orange-50 p-3">
            <div className="text-muted text-xs uppercase">
              Monthly Cost from Purchases
              <HelpTip text="Steady-state monthly loan payments + ongoing costs from all purchases" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              +{formatCurrency(r.steadyStateMonthlyFromPurchases)}/mo
            </div>
          </div>
          <div className="rounded-lg bg-orange-50 p-3">
            <div className="text-muted text-xs uppercase">
              Annual from Purchases
              <HelpTip text="Total annualized cost from loan payments + ongoing costs, added to relocation expenses" />
            </div>
            <div className="text-lg font-bold text-orange-700">
              +{formatCurrency(r.steadyStateMonthlyFromPurchases * 12)}/yr
            </div>
            <div className="text-faint text-xs">
              added to relocation expenses
            </div>
          </div>
        </div>
      )}

      {/* Large purchases list + add form */}
      <div className="border-t pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-secondary text-sm font-medium">
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
          <div className="mb-2 flex flex-wrap gap-2">
            {relocLargePurchases.map((p) => {
              const isFinanced =
                p.downPaymentPercent !== undefined && p.downPaymentPercent < 1;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-1 rounded bg-orange-50 px-2 py-1 text-xs text-orange-700"
                >
                  <span className="font-medium">{p.name}</span>
                  <span>
                    {formatCurrency(p.purchasePrice)} in {p.purchaseYear}
                  </span>
                  {isFinanced && (
                    <span className="text-orange-400">
                      ({formatPercent(p.downPaymentPercent ?? 0)} down,{" "}
                      {p.loanTermYears}-year @
                      {formatPercent(p.loanRate ?? 0, 1)})
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
          <div className="bg-surface-sunken mb-2 space-y-2 rounded-lg p-3">
            <PurchaseBasicsFields
              purchaseForm={purchaseForm}
              setPurchaseForm={setPurchaseForm}
            />

            <PurchaseCostFields
              purchaseForm={purchaseForm}
              setPurchaseForm={setPurchaseForm}
            />

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
                  const rawDownPaymentPercent = parseFloat(
                    purchaseForm.downPaymentPercent,
                  );
                  const rawLoanRate = parseFloat(purchaseForm.loanRate);
                  const rawLoanTermYears = parseInt(
                    purchaseForm.loanTermYears,
                    10,
                  );
                  purchase.downPaymentPercent =
                    (Number.isFinite(rawDownPaymentPercent)
                      ? rawDownPaymentPercent
                      : DEFAULT_LOAN_DOWN_PAYMENT_PERCENT) / 100;
                  purchase.loanRate =
                    (Number.isFinite(rawLoanRate)
                      ? rawLoanRate
                      : DEFAULT_LOAN_RATE) / 100;
                  purchase.loanTermYears = Number.isFinite(rawLoanTermYears)
                    ? rawLoanTermYears
                    : DEFAULT_LOAN_TERM_YEARS;
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
                  downPaymentPercent: String(DEFAULT_LOAN_DOWN_PAYMENT_PERCENT),
                  loanRate: String(DEFAULT_LOAN_RATE),
                  loanTermYears: String(DEFAULT_LOAN_TERM_YEARS),
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
