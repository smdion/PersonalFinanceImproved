import { SavingsAllocationPanel } from "@/components/budget";
import { WhatIfStep } from "./what-if-step";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfSavingsStepProps = {
  activeColumn: number;
  budgetId: number | null;
  cols: string[];
  leftover: number | null;
  setPickedBudgetId: Dispatch<SetStateAction<number | null>>;
};

export function WhatIfSavingsStep({
  activeColumn,
  budgetId,
  cols,
  leftover,
  setPickedBudgetId,
}: WhatIfSavingsStepProps) {
  return (
    <WhatIfStep
      number={4}
      title="Savings"
      description="What's left over gets allocated here."
    >
      <SavingsAllocationPanel
        canEdit
        // No padlock to gate this: sandbox mode writes nothing but local
        // preview state (via onLocalChange below), so it's always editable.
        locked={false}
        sandbox
        viewingProfileId={budgetId}
        // The rail's own selection IS the tab's Budget Profile picker —
        // not a second, independent one.
        onSelectProfile={setPickedBudgetId}
        // No onActivateProfile: activating writes global state.
        livePoolEstimate={leftover}
        livePoolColumnLabel={cols[activeColumn]}
        onLocalChange={() => {
          // Sandbox savings edits are local-only for this preview session
          // (no downstream consumer needs them yet — the leftover figure
          // above already reflects the salary/budget sandbox). Accepting
          // the callback (rather than omitting it) is what keeps the
          // table's writes redirected away from the real upsert mutation.
        }}
      />
    </WhatIfStep>
  );
}
