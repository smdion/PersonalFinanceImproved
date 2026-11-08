/** The Relocation calculator's add-purchase form fields: what is bought and
 *  when, and how it is paid for. */

import { useId } from "react";
import { HelpTip } from "@/components/ui/help-tip";

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

type PurchaseFieldsProps = {
  purchaseForm: PurchaseFormState;
  setPurchaseForm: React.Dispatch<React.SetStateAction<PurchaseFormState>>;
};

/** Name, price, year and whether it is financed. */
export function PurchaseBasicsFields({
  purchaseForm,
  setPurchaseForm,
}: PurchaseFieldsProps) {
  const id = useId();
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-name`} className="text-muted block text-xs">
            Name
          </label>
          <input
            id={`${id}-name`}
            type="text"
            className="w-full rounded border px-2 py-1 text-sm"
            placeholder="e.g. New Home"
            value={purchaseForm.name}
            onChange={(e) =>
              setPurchaseForm((f) => ({ ...f, name: e.target.value }))
            }
          />
        </div>
        <div>
          <label htmlFor={`${id}-price`} className="text-muted block text-xs">
            Purchase Price ($)
          </label>
          <input
            id={`${id}-price`}
            type="number"
            className="w-full rounded border px-2 py-1 text-sm"
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
          <label htmlFor={`${id}-year`} className="text-muted block text-xs">
            Purchase Year
          </label>
          <input
            id={`${id}-year`}
            type="number"
            className="w-full rounded border px-2 py-1 text-sm"
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
        <label className="text-muted flex cursor-pointer items-center gap-1 text-xs">
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
    </>
  );
}

/** The loan terms (when financed), ongoing cost and sale proceeds. */
export function PurchaseCostFields({
  purchaseForm,
  setPurchaseForm,
}: PurchaseFieldsProps) {
  const id = useId();
  return (
    <>
      {purchaseForm.financed && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div>
            <label htmlFor={`${id}-down`} className="text-muted block text-xs">
              Down Payment %
            </label>
            <input
              id={`${id}-down`}
              type="number"
              className="w-full rounded border px-2 py-1 text-sm"
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
            <label htmlFor={`${id}-rate`} className="text-muted block text-xs">
              Loan Rate %
            </label>
            <input
              id={`${id}-rate`}
              type="number"
              step="0.1"
              className="w-full rounded border px-2 py-1 text-sm"
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
            <label htmlFor={`${id}-term`} className="text-muted block text-xs">
              Loan Term (years)
            </label>
            <input
              id={`${id}-term`}
              type="number"
              className="w-full rounded border px-2 py-1 text-sm"
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-monthly`} className="text-muted block text-xs">
            Ongoing Monthly Cost ($)
            <HelpTip text="Property tax, HOA, insurance, maintenance — any recurring monthly cost from this purchase" />
          </label>
          <input
            id={`${id}-monthly`}
            type="number"
            className="w-full rounded border px-2 py-1 text-sm"
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
          <label
            htmlFor={`${id}-proceeds`}
            className="text-muted block text-xs"
          >
            Sale Proceeds ($)
            <HelpTip text="Net proceeds from selling an existing asset (e.g. current home equity minus closing costs). Offsets the cash outlay." />
          </label>
          <input
            id={`${id}-proceeds`}
            type="number"
            className="w-full rounded border px-2 py-1 text-sm"
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
    </>
  );
}
