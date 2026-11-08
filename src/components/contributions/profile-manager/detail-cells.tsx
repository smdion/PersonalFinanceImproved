import type { ComponentType } from "react";
import { takesFromBonusCheck } from "@/lib/pure/paycheck/bonus";
import { formatCurrency } from "@/lib/utils/format";
import { formatEmployerMatch } from "@/lib/pure/contributions/match-display";
import type { ContribAccountActiveFields } from "@/lib/pure/household/profiles";
import type { AccountDetail } from "./account-row-types";
import type { AccountFieldKey } from "./account-fields";

/** One account row's values, as each read-only cell reads them. */
export type DetailRowProps = {
  ad: AccountDetail;
  af: ContribAccountActiveFields;
  isProfileDisabled: boolean;
  hasActiveName: string | boolean;
  activeMethod: string | undefined;
  hasValue: boolean;
  methodSuffix: string;
  activeValue: string | number | undefined;
  matchSource: AccountDetail;
  isCombined: boolean;
};

function DetailAccountCell({
  isProfileDisabled,
  hasActiveName,
  ad,
  af,
}: DetailRowProps) {
  return (
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
  );
}

function DetailMethodCell({ activeMethod }: DetailRowProps) {
  return (
    <td className="text-muted px-3 py-1.5 whitespace-nowrap">
      {activeMethod
        ? activeMethod === "percent_of_salary"
          ? "% salary"
          : "fixed"
        : "—"}
    </td>
  );
}

function DetailValueCell({
  hasValue,
  isProfileDisabled,
  methodSuffix,
  activeValue,
}: DetailRowProps) {
  return (
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
  );
}

function DetailMatchCell({ matchSource, isCombined }: DetailRowProps) {
  return (
    <td className="text-faint px-3 py-1.5 text-right whitespace-nowrap">
      {renderDetailMatch(matchSource, isCombined)}
    </td>
  );
}

/** The read-only panel's cell for each field it shows. */
export const DETAIL_CELLS: Partial<
  Record<AccountFieldKey, ComponentType<DetailRowProps>>
> = {
  account: DetailAccountCell,
  method: DetailMethodCell,
  value: DetailValueCell,
  match: DetailMatchCell,
};

function renderDetailMatch(matchSource: AccountDetail, isCombined: boolean) {
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
