import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { renderDetailAccountRows } from "./profile-detail-rows";
import type { ActiveFieldsRoot, DeductionRow } from "./profile-types";
import { AccountFieldHeaders } from "./account-fields";

export function ProfileDetailPanel({ profileId }: { profileId: number }) {
  const { data: profile, isLoading } =
    trpc.contributionProfile.getById.useQuery({ id: profileId });
  const { data: deductionRows } = trpc.settings.deductions.list.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="bg-surface-elevated h-6 w-48 animate-pulse rounded" />
        <div className="bg-surface-elevated h-32 animate-pulse rounded" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div>
      {/* Profile header — the viewing/active state is already shown in the
          summary bar above; this just names which profile's detail this is. */}
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-primary text-sm font-semibold">{profile.name}</h3>
        {profile.description && (
          <span className="text-caption text-faint">
            — {profile.description}
          </span>
        )}
      </div>

      {/* Contributions section — salary is entirely the Salary Profiles
          tab's domain now, so it is deliberately not shown here. */}
      <div>
        <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
          Contribution Accounts
        </h4>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-strong border-b-2">
              <AccountFieldHeaders view="readOnly" />
            </tr>
          </thead>
          <tbody>{renderDetailAccountRows(profile)}</tbody>
        </table>
      </div>

      {/* Deductions section — paycheck_deductions carries no amount of its
          own any more (Stage B): amountPerPeriod resolves entirely through
          this profile's deductions active-fields, the same "no base value,
          absent = incomplete" rule contributionAccounts already uses (see
          deductionActiveFieldsSchema / applyDeductionActiveFields). */}
      {deductionRows && deductionRows.length > 0 && (
        <div className="mt-5">
          <h4 className="text-label text-muted mb-2 font-semibold tracking-wide uppercase">
            Deductions
          </h4>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-strong border-b-2">
                <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                  Deduction
                </th>
                <th className="text-muted w-24 px-3 py-2 text-left font-medium">
                  Pretax
                </th>
                <th className="text-muted w-28 px-3 py-2 text-right font-medium">
                  Amount / Period
                </th>
              </tr>
            </thead>
            <tbody>
              {deductionRows.map((d: DeductionRow, rowIdx: number) => {
                const activeFieldsRoot = (profile.contributionActiveFields ?? // Stored jsonb, typed by $type only: kept guarded.
                  {}) as ActiveFieldsRoot;
                const af = activeFieldsRoot.deductions?.[String(d.id)] as
                  Record<string, unknown> | undefined;
                const activeAmount = af?.amountPerPeriod as
                  string | number | undefined;
                const personName =
                  profile.deductionDetails.find((dd) => dd.id === d.id)
                    ?.employerName ?? `Job ${d.jobId}`;
                return (
                  <tr
                    key={d.id}
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    }`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      {d.deductionName}
                      <span className="text-faint"> — {personName}</span>
                    </td>
                    <td className="text-muted px-3 py-1.5">
                      {d.isPretax ? "Pretax" : "Post-tax"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        activeAmount !== undefined
                          ? "font-medium text-amber-600"
                          : "text-secondary"
                      }`}
                    >
                      {activeAmount !== undefined ? (
                        formatCurrency(parseFloat(String(activeAmount)))
                      ) : (
                        <span className="text-faint italic">Not set</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
