import React from "react";
import { formatCurrency } from "@/lib/utils/format";
import { confirm } from "@/components/ui/confirm-dialog";
import {
  Detail,
  SalaryCell,
  TABLE_COLUMNS,
  rowClass,
  JobPicker,
  EntrySections,
} from "./salary-profile-entry";

export type SalaryEditRowsProps = {
  addEntry: (jobId: number | null) => void;
  commitSalary: (sd: Detail) => void;
  drafts: Record<string, string>;
  isActiveProfile: boolean;
  isSaving: boolean;
  rawSd: Detail;
  removeEntry: (jobId: number | null) => void;
  rowIndex: number;
  sd: Detail;
  setDraft: (key: string, value: string) => void;
  setJobOverride: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  updateEntry: (sd: Detail) => (field: string, value: string) => void;
};

/** One job's editable row and, when it has an entry, its sections row. */
export function SalaryEditRows({
  addEntry,
  commitSalary,
  drafts,
  isActiveProfile,
  isSaving,
  rawSd,
  removeEntry,
  rowIndex,
  sd,
  setDraft,
  setJobOverride,
  updateEntry,
}: SalaryEditRowsProps) {
  return (
    <>
      <tr
        aria-busy={isSaving}
        className={`${rowClass(rowIndex)} ${isSaving ? "pointer-events-none opacity-60" : ""}`}
      >
        <td className="text-secondary py-1.5 pr-3 pl-4 font-medium">
          {sd.personName}
        </td>
        <td className="text-muted px-3 py-1.5">
          <JobPicker
            sd={sd}
            rawSd={rawSd}
            onChange={(jobId) =>
              setJobOverride((prev) => ({
                ...prev,
                [rawSd.personId]: jobId,
              }))
            }
          />
        </td>
        {sd.hasEntry ? (
          <>
            <td className="px-3 py-1.5">
              <SalaryCell
                sd={sd}
                draft={drafts[`${sd.personId}:salary`]}
                onDraft={(v) => setDraft(`${sd.personId}:salary`, v)}
                onCommit={() => commitSalary(sd)}
              />
            </td>
            <td className="text-secondary px-3 py-1.5 text-right tabular-nums">
              {formatCurrency(sd.estimatedBonus)}
            </td>
            <td className="py-1.5 pr-4 pl-3 text-right">
              <div className="flex items-center justify-end gap-2">
                <span className="text-secondary font-medium tabular-nums">
                  {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (
                      await confirm(
                        `Remove ${sd.employerName ?? "this job"} from this profile? It then contributes $0 here.`,
                      )
                    )
                      removeEntry(sd.jobId);
                  }}
                  title="Remove this job from the profile"
                  aria-label={`Remove ${sd.employerName ?? "this job"} from this profile`}
                  className="text-caption text-faint shrink-0 hover:text-red-500"
                >
                  ×
                </button>
              </div>
            </td>
          </>
        ) : (
          <td
            colSpan={TABLE_COLUMNS - 2}
            className="text-faint px-3 py-1.5 text-right"
          >
            <div className="flex items-center justify-end gap-2">
              <span>Not in this profile</span>
              <button
                type="button"
                onClick={() => addEntry(sd.jobId)}
                disabled={sd.jobId === null}
                className="text-caption font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                + Add
              </button>
            </div>
          </td>
        )}
      </tr>
      {sd.hasEntry && (
        <tr className={rowClass(rowIndex)}>
          <td
            colSpan={TABLE_COLUMNS}
            className="bg-surface-sunken/60 px-4 py-3"
          >
            <EntrySections
              sd={sd}
              editable
              onUpdate={updateEntry(sd)}
              isActiveProfile={isActiveProfile}
            />
          </td>
        </tr>
      )}
    </>
  );
}
