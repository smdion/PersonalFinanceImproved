import type { useSandboxState } from "./use-what-if-sandbox";
import { formatCurrency } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WhatIfContributionsEditor,
  WhatIfDeductionsEditor,
  type ContribAddition,
  type DeductionAddition,
} from "./what-if-editors";
import { WhatIfStep } from "./what-if-step";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfContributionsStepProps = {
  canManagePaycheck: boolean;
  contribMakeRealPendingId: number | null;
  contribProfileName: string | null;
  contribTotals: { annual: number; match: number };
  deductionMakeRealPendingId: number | null;
  handleMakeDeductionReal: (addition: DeductionAddition, jobId: number) => void;
  paycheckLoading: boolean;
  sandbox: ReturnType<typeof useSandboxState>;
  setMakeRealAddition: Dispatch<SetStateAction<ContribAddition | null>>;
  views: PaycheckPersonView[];
};

export function WhatIfContributionsStep({
  canManagePaycheck,
  contribMakeRealPendingId,
  contribProfileName,
  contribTotals,
  deductionMakeRealPendingId,
  handleMakeDeductionReal,
  paycheckLoading,
  sandbox,
  setMakeRealAddition,
  views,
}: WhatIfContributionsStepProps) {
  return (
    <WhatIfStep
      number={2}
      title={`Contributions${contribProfileName ? ` — ${contribProfileName}` : ""}`}
      description="What you and your employer put toward retirement/savings accounts, and what's deducted from your paycheck."
      headerExtra={
        views.length > 0 && contribProfileName ? (
          <span className="text-xs font-semibold text-indigo-700">
            {formatCurrency(contribTotals.annual)}/yr you
            {contribTotals.match > 0 && (
              <> · {formatCurrency(contribTotals.match)}/yr employer match</>
            )}
          </span>
        ) : undefined
      }
    >
      {paycheckLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : views.length === 0 ? (
        <p className="text-caption text-faint italic">
          No active jobs to preview.
        </p>
      ) : (
        <WhatIfContributionsEditor
          views={views}
          activeFields={sandbox.contribActiveFields}
          onEdit={sandbox.setContribActiveField}
          onReset={sandbox.resetContribActiveField}
          additions={sandbox.contribAdditions}
          onAddAccount={sandbox.addContribAddition}
          onUpdateAddition={sandbox.updateContribAddition}
          onRemoveAddition={sandbox.removeContribAddition}
          canManagePaycheck={canManagePaycheck}
          onMakeReal={setMakeRealAddition}
          makeRealPendingId={contribMakeRealPendingId}
        />
      )}
      {!paycheckLoading && views.length > 0 && (
        <WhatIfDeductionsEditor
          views={views}
          deductionEdits={sandbox.deductionEdits}
          onEditDeduction={sandbox.setDeductionEdit}
          onResetDeduction={sandbox.resetDeductionEdit}
          additions={sandbox.deductionAdditions}
          onAddDeduction={sandbox.addDeduction}
          onUpdateAddition={sandbox.updateDeductionAddition}
          onRemoveAddition={sandbox.removeDeductionAddition}
          canManagePaycheck={canManagePaycheck}
          onMakeReal={handleMakeDeductionReal}
          makeRealPendingId={deductionMakeRealPendingId}
        />
      )}
    </WhatIfStep>
  );
}
