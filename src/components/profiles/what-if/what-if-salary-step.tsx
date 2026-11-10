import type { useSandboxState } from "./use-what-if-sandbox";
import { formatCurrency } from "@/lib/utils/format";
import { Skeleton } from "@/components/ui/skeleton";
import { WhatIfPaycheckSummary } from "./what-if-paycheck-summary";
import { WhatIfStep } from "./what-if-step";
import { WhatIfSalaryEditor } from "./what-if-salary-editor";
import type { PaycheckPersonView } from "@/lib/hooks/use-paycheck-person-views";

export type WhatIfSalaryStepProps = {
  netMonthlyIncome: number | null;
  paycheckLoading: boolean;
  salaryProfileName: string | null;
  sandbox: ReturnType<typeof useSandboxState>;
  views: PaycheckPersonView[];
};

export function WhatIfSalaryStep({
  netMonthlyIncome,
  paycheckLoading,
  salaryProfileName,
  sandbox,
  views,
}: WhatIfSalaryStepProps) {
  return (
    <WhatIfStep
      number={1}
      title={`Paycheck${salaryProfileName ? ` — ${salaryProfileName}` : ""}`}
      description="Edit salary or bonus to see the resulting take-home pay."
      headerExtra={
        netMonthlyIncome != null ? (
          <span className="text-xs font-semibold text-indigo-700">
            {formatCurrency(netMonthlyIncome)}/mo net
          </span>
        ) : undefined
      }
    >
      {paycheckLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : views.length === 0 ? (
        <p className="text-caption text-faint italic">
          No active jobs to preview.
        </p>
      ) : (
        <div className="space-y-3">
          <WhatIfSalaryEditor
            views={views}
            entries={sandbox.salaryEntries}
            onChange={sandbox.setSalaryField}
          />
          <WhatIfPaycheckSummary views={views} />
        </div>
      )}
    </WhatIfStep>
  );
}
