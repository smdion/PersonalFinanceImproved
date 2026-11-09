import React from "react";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import {
  Detail,
  SalaryTableHead,
  TABLE_COLUMNS,
  rowClass,
  TotalsFooter,
  EntrySections,
} from "./salary-profile-entry";

/**
 * Read-only detail view — used when canEdit is false and whenever the padlock
 * is locked. A job either has a real entry in this profile (shown plainly)
 * or it doesn't (shown as "—", contributing $0).
 */
export function ProfileDetail({
  profileId,
  isActiveProfile,
}: {
  profileId: number;
  isActiveProfile: boolean;
}) {
  const { data: profile } = trpc.salaryProfile.getById.useQuery({
    id: profileId,
  });
  if (!profile) return null;

  const salaryCell = (sd: Detail) => (
    <td
      className={`px-3 py-1.5 text-right tabular-nums ${
        sd.hasEntry ? "text-secondary" : "text-faint"
      }`}
    >
      {sd.hasEntry ? formatCurrency(sd.salary) : "—"}
    </td>
  );

  return (
    <div className="bg-surface-sunken rounded-lg p-4">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-primary text-sm font-semibold">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
        Salary &amp; Bonus
      </h4>
      <table className="w-full border-collapse text-xs">
        <SalaryTableHead />
        <tbody>
          {profile.salaryDetails.map((sd, rowIndex) => {
            return (
              <React.Fragment key={sd.personId}>
                <tr className={rowClass(rowIndex)}>
                  <td className="text-secondary py-1.5 pr-3 pl-4 font-medium">
                    {sd.personName}
                  </td>
                  <td className="text-muted px-3 py-1.5">
                    {sd.employerName ?? "No active job"}
                    {!sd.hasEntry && sd.jobId !== null && (
                      <span className="text-caption text-faint ml-1">
                        (not in this profile)
                      </span>
                    )}
                  </td>
                  {salaryCell(sd)}
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      sd.hasEntry ? "text-secondary" : "text-faint"
                    }`}
                  >
                    {sd.hasEntry ? formatCurrency(sd.estimatedBonus) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 pl-3 text-right">
                    <span className="text-secondary font-medium tabular-nums">
                      {formatCurrency(sd.effectiveSalary + sd.estimatedBonus)}
                    </span>
                  </td>
                </tr>
                {sd.hasEntry && (
                  <tr className={rowClass(rowIndex)}>
                    <td
                      colSpan={TABLE_COLUMNS}
                      className="bg-surface-sunken/60 px-4 py-3"
                    >
                      <EntrySections
                        sd={sd}
                        editable={false}
                        onUpdate={() => {}}
                        isActiveProfile={isActiveProfile}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <TotalsFooter combinedIncome={profile.combinedIncome} />
      </table>
    </div>
  );
}
