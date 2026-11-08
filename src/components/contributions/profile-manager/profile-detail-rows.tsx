/** The read-only panel's account rows. */
import { takesFromBonusCheck } from "@/lib/pure/paycheck/bonus";
import type { RouterOutputs } from "@/lib/trpc";
import { formatCurrency } from "@/lib/utils/format";
import { formatEmployerMatch } from "@/lib/pure/contributions/match-display";
import {
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
} from "@/lib/pure/household/profiles";
import { groupSharedMatchAccounts } from "./match-groups";

export function renderDetailAccountRows(
  profile: NonNullable<RouterOutputs["contributionProfile"]["getById"]>,
) {
  // A Roth/Traditional split of one account shares one match,
  // entered on one row and applied to their combined
  // contributions: every row in the group shows the same match
  // text (when exactly one row holds the match; else per row).
  const { sharedMatchSource, combinedGroupIds } = groupSharedMatchAccounts(
    profile.accountDetails,
  );

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
          rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
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
          {renderDetailMatch(matchSource, isCombined)}
        </td>
      </tr>
    );
  });
}

export function renderDetailMatch(
  matchSource: NonNullable<
    RouterOutputs["contributionProfile"]["getById"]
  >["accountDetails"][number],
  isCombined: boolean,
) {
  const matchText = formatEmployerMatch(
    matchSource.liveMatchType,
    matchSource.liveMatchValue,
    matchSource.liveMaxMatchPct,
    matchSource.liveMatchRate,
  );
  return matchText ? (
    <span title={isCombined ? "Combined with other split" : undefined}>
      {matchText}
      {isCombined && <span className="italic"> (combined)</span>}
    </span>
  ) : (
    <span className="text-faint">—</span>
  );
}
