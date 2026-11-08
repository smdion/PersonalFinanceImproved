import type { AccumOverride, DecumOverride } from "./types";
import type { ProjectionState } from "./projection-table-types";
import { LumpSumForm } from "./lump-sum-form";
import { investedAtStartOf } from "@/lib/pure/advice/goldilocks";

export type LumpSumFieldsProps = {
  isPostRetirement: boolean;
  resetWizard: () => void;
  selectedYear: string;
  state: ProjectionState;
  year: number;
};

export function LumpSumFields({
  isPostRetirement,
  resetWizard,
  selectedYear,
  state,
  year,
}: LumpSumFieldsProps) {
  return (
    <LumpSumForm
      accounts={state.individualAccountNames}
      investedAtStartOf={(year) =>
        investedAtStartOf(state.result?.projectionByYear ?? [], year)
      }
      onAdd={(ls) => {
        const lumpEntry = {
          id: ls.id,
          amount: Math.abs(parseFloat(ls.amount)),
          targetAccount: ls.targetAccount,
          ...(ls.targetAccountName
            ? { targetAccountName: ls.targetAccountName }
            : {}),
          ...(ls.targetOwnerName
            ? { targetOwnerName: ls.targetOwnerName }
            : {}),
          ...(ls.label ? { label: ls.label } : {}),
        };
        if (isPostRetirement) {
          const o: DecumOverride = {
            year,
            lumpSums: [lumpEntry],
          };
          state.setDecumOverrides((prev) =>
            [...prev, o].sort((a, b) => a.year - b.year),
          );
        } else {
          const o: AccumOverride = {
            year,
            lumpSums: [lumpEntry],
          };
          state.setAccumOverrides((prev) =>
            [...prev, o].sort((a, b) => a.year - b.year),
          );
        }
        resetWizard();
      }}
      defaultYear={selectedYear}
    />
  );
}

export type ResetFieldsProps = {
  isPostRetirement: boolean;
  resetWizard: () => void;
  selectedYear: string;
  state: ProjectionState;
  year: number;
};

export function ResetFields({
  isPostRetirement,
  resetWizard,
  selectedYear,
  state,
  year,
}: ResetFieldsProps) {
  return (
    <>
      <p className="text-muted text-xs">
        This will revert all {isPostRetirement ? "withdrawal" : "contribution"}{" "}
        settings to page defaults starting in {selectedYear}.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (isPostRetirement) {
              state.setDecumOverrides((prev) =>
                [...prev, { year, reset: true }].sort(
                  (a, b) => a.year - b.year,
                ),
              );
            } else {
              state.setAccumOverrides((prev) =>
                [...prev, { year, reset: true }].sort(
                  (a, b) => a.year - b.year,
                ),
              );
            }
            resetWizard();
          }}
          className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700"
        >
          Reset from {selectedYear}
        </button>
        <button
          type="button"
          onClick={resetWizard}
          className="text-muted hover:text-primary px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    </>
  );
}
