import { takesFromBonusCheck } from "@/lib/pure/paycheck/bonus";
import { trpc } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { formatEmployerMatch } from "@/lib/pure/contributions/match-display";
import {
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
} from "@/lib/pure/household/profiles";
import { groupSharedMatchAccounts } from "./match-groups";
import type { ActiveFieldsRoot, DeductionRow } from "./profile-types";

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
              <th className="text-muted py-2 pr-3 pl-4 text-left font-medium">
                Account
              </th>
              <th className="text-muted w-20 px-3 py-2 text-left font-medium whitespace-nowrap">
                Method
              </th>
              <th className="text-muted w-24 px-3 py-2 text-right font-medium">
                Value
              </th>
              <th className="text-muted w-28 px-3 py-2 text-right font-medium">
                Match
              </th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // A Roth/Traditional split of one account shares one match,
              // entered on one row and applied to their combined
              // contributions: every row in the group shows the same match
              // text (when exactly one row holds the match; else per row).
              const { sharedMatchSource, combinedGroupIds } =
                groupSharedMatchAccounts(profile.accountDetails);

              return profile.accountDetails.map((ad, rowIdx) => {
                const af = ad.activeFields as ContribAccountActiveFields;
                const {
                  hasValue,
                  isDisabled: isProfileDisabled,
                  value: activeValue,
                  methodSuffix,
                } = resolveContribFieldDisplayState(af);
                const activeMethod = af?.contributionMethod;
                const hasActiveName =
                  ad.liveAccountName && ad.accountName !== ad.liveAccountName;
                const sharedFrom = sharedMatchSource.get(ad.id);
                const matchSource = sharedFrom ?? ad;
                const isCombined = combinedGroupIds.has(ad.id);
                return (
                  <tr
                    key={ad.id}
                    className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
                      rowIdx % 2 === 1
                        ? "bg-surface-sunken/60"
                        : "bg-surface-primary"
                    } ${isProfileDisabled ? "opacity-40" : ""}`}
                  >
                    <td className="text-secondary py-1.5 pr-3 pl-4">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`${isProfileDisabled ? "line-through" : ""} ${hasActiveName ? "text-amber-600" : ""}`}
                        >
                          {ad.accountName}
                        </span>
                        {isProfileDisabled && (
                          <span className="text-micro border-strong text-muted shrink-0 rounded border px-1 py-0.5 font-semibold">
                            OFF HERE
                          </span>
                        )}
                        {!ad.liveIsActive && (
                          <span
                            className="text-micro shrink-0 font-medium text-amber-500"
                            title="This account isn't a funding target — any value set for it here has no effect. Restore it from the profile editor."
                          >
                            not a funding target
                          </span>
                        )}
                        {takesFromBonusCheck({
                          isPayrollDeducted: ad.liveIsPayroll,
                          fromBonus: af?.fromBonus,
                        }) && (
                          <span className="text-micro text-faint shrink-0">
                            also from bonus checks
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="text-muted px-3 py-1.5 whitespace-nowrap">
                      {activeMethod
                        ? activeMethod === "percent_of_salary"
                          ? "% salary"
                          : "fixed"
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${
                        hasValue && !isProfileDisabled
                          ? "font-medium text-amber-600"
                          : "text-secondary"
                      }`}
                    >
                      {hasValue ? (
                        methodSuffix === "%" ? (
                          `${activeValue}%`
                        ) : (
                          formatCurrency(parseFloat(String(activeValue)))
                        )
                      ) : (
                        <span className="text-faint italic">Not set</span>
                      )}
                    </td>
                    <td className="text-faint px-3 py-1.5 text-right whitespace-nowrap">
                      {(() => {
                        const matchText = formatEmployerMatch(
                          matchSource.liveMatchType,
                          matchSource.liveMatchValue,
                          matchSource.liveMaxMatchPct,
                          matchSource.liveMatchRate,
                        );
                        return matchText ? (
                          <span
                            title={
                              isCombined
                                ? "Combined with other split"
                                : undefined
                            }
                          >
                            {matchText}
                            {isCombined && (
                              <span className="italic"> (combined)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
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
