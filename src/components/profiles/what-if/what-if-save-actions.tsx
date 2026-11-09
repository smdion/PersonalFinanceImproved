import type { useSandboxState } from "./use-what-if-sandbox";
import { trpc } from "@/lib/trpc";
import { HelpTip } from "@/components/ui/help-tip";
import { FormError } from "@/components/ui/form-error";
import type { Dispatch, SetStateAction } from "react";

export type WhatIfSaveActionsProps = {
  budgetId: number | null;
  budgetProfileName: string;
  canCreatePlan: boolean;
  canDuplicateProfile: boolean;
  createPlan: ReturnType<typeof trpc.settings.scenarios.create.useMutation>;
  duplicateLabel: string;
  duplicateName: string;
  duplicateProfile: ReturnType<typeof trpc.budget.duplicateProfile.useMutation>;
  planLabel: "Saving…" | "Save as Plan";
  planName: string;
  planProfiles: {
    salaryProfileId: number;
    contributionProfileId: number;
    budgetProfileId: number;
    retirementProfileId: number;
  } | null;
  salaryEditCount: number;
  sandbox: ReturnType<typeof useSandboxState>;
  setDuplicateName: Dispatch<SetStateAction<string>>;
  setPlanName: Dispatch<SetStateAction<string>>;
};

export function WhatIfSaveActions({
  budgetId,
  budgetProfileName,
  canCreatePlan,
  canDuplicateProfile,
  createPlan,
  duplicateLabel,
  duplicateName,
  duplicateProfile,
  planLabel,
  planName,
  planProfiles,
  salaryEditCount,
  sandbox,
  setDuplicateName,
  setPlanName,
}: WhatIfSaveActionsProps) {
  return (
    <>
      {(canDuplicateProfile || canCreatePlan) && (
        <section className="border-default bg-surface-sunken/40 space-y-3 rounded-lg border p-4">
          <h3 className="text-primary text-sm font-semibold">Keep this</h3>
          {canDuplicateProfile && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={duplicateName}
                onChange={(e) => setDuplicateName(e.target.value)}
                placeholder={
                  budgetProfileName
                    ? `Copy of ${budgetProfileName}`
                    : "New profile name"
                }
                className="bg-surface-primary w-56 rounded border px-2 py-1 text-xs"
                aria-label="New budget profile name"
              />
              <button
                type="button"
                disabled={
                  budgetId == null ||
                  !duplicateName.trim() ||
                  duplicateProfile.isPending
                }
                onClick={() =>
                  duplicateProfile.mutate({
                    sourceProfileId: budgetId!,
                    name: duplicateName.trim(),
                    ...(sandbox.itemAmountActiveFields.length > 0
                      ? {
                          itemAmountActiveFields:
                            sandbox.itemAmountActiveFields,
                        }
                      : {}),
                  })
                }
                className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {duplicateLabel}
              </button>
              <span className="text-caption text-faint">
                Copies modes, items and savings allocations.
                <HelpTip text="The copy starts inactive, and API-sync links and contribution-account links are intentionally NOT copied — two profiles pushing to the same external category is a real-money hazard. Re-link them on the copy if you want them." />
              </span>
              <FormError error={duplicateProfile.error} prefix="Failed" />
            </div>
          )}
          {canCreatePlan && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                placeholder="New Plan name"
                className="bg-surface-primary w-56 rounded border px-2 py-1 text-xs"
                aria-label="New Plan name"
              />
              <button
                type="button"
                disabled={
                  !planName.trim() || !planProfiles || createPlan.isPending
                }
                onClick={() => {
                  if (planProfiles)
                    createPlan.mutate({
                      name: planName.trim(),
                      ...planProfiles,
                    });
                }}
                className="hover:bg-surface-sunken rounded border px-2.5 py-1 text-xs"
              >
                {planLabel}
              </button>
              <span className="text-caption text-faint">
                Saves these profiles, plus your active Retirement profile, as a
                Plan you can apply from the top bar.
                {salaryEditCount > 0 && (
                  <>
                    {" "}
                    A Plan holds profiles, not edited amounts — save your salary
                    edits as a Salary Profile first.
                  </>
                )}
              </span>
              <FormError error={createPlan.error} prefix="Failed" />
            </div>
          )}
        </section>
      )}
    </>
  );
}
