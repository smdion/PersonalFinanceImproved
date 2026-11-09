import type { RouterOutputs } from "@/lib/trpc";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import { safeDivide } from "@/lib/utils/math";
import {
  accountColor,
  accountMatchColor,
  accountTextColor,
} from "@/lib/utils/colors";

/** A joint account's contributions, shown once for the household. */
export function renderJointAccount(
  categoryKey: string,
  employerMatchLabel: string,
  hasDiscountBar: boolean,
  householdMult: number,
  jointAccountTypes: NonNullable<
    NonNullable<
      RouterOutputs["contribution"]["computeSummary"]
    >["jointAccountTypes"]
  >,
  periodSuffix: string,
  type: string,
) {
  // Use joint account data from household-level response
  const jat = jointAccountTypes.find((a) => a.accountType === type);
  if (!jat) return null;
  const totalEmployee = jat.employeeContrib * householdMult;
  const totalMatch = jat.employerMatch * householdMult;
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {formatCurrency(totalEmployee)}
          {periodSuffix}
        </span>
        {totalMatch > 0 && (
          <span className="text-muted text-sm">
            +{formatCurrency(totalMatch)}{" "}
            <span className="text-faint text-xs">{employerMatchLabel}</span>
          </span>
        )}
      </div>
      {/* Bar for joint accounts */}
      {hasDiscountBar && jat.employerMatch > 0 && jat.employeeContrib > 0 ? (
        <div className="mt-1.5">
          <div className="bg-surface-strong relative h-2 w-full rounded-full">
            <div
              className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full transition-all`}
              style={{
                width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
              }}
              title={`Your cost: ${formatCurrency(totalEmployee)}${periodSuffix}`}
            />
            <div
              className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full transition-all`}
              style={{
                left: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                width: `${(jat.employerMatch / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
              }}
              title={`${employerMatchLabel}: ${formatCurrency(totalMatch)}${periodSuffix}`}
            />
          </div>
          <div className="text-caption mt-0.5 flex justify-between">
            <span className={accountTextColor(categoryKey)}>
              Total value:{" "}
              {formatCurrency(
                (jat.employeeContrib + jat.employerMatch) * householdMult,
              )}
              {periodSuffix}
            </span>
            <span className={`${accountTextColor(categoryKey)} font-medium`}>
              +
              {formatPercent(
                safeDivide(jat.employerMatch, jat.employeeContrib, 0),
              )}{" "}
              {employerMatchLabel}
            </span>
          </div>
        </div>
      ) : (
        <div className="mt-1.5">
          <div className="bg-surface-strong relative h-2 w-full rounded-full">
            {jat.employerMatch > 0 ? (
              <>
                <div
                  className={`${accountColor(categoryKey)} absolute top-0 left-0 h-2 rounded-l-full`}
                  style={{
                    width: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                  }}
                  title={`You: ${formatCurrency(totalEmployee)}${periodSuffix}`}
                />
                <div
                  className={`${accountMatchColor(categoryKey)} absolute top-0 h-2 rounded-r-full`}
                  style={{
                    left: `${(jat.employeeContrib / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                    width: `${(jat.employerMatch / (jat.employeeContrib + jat.employerMatch)) * 100}%`,
                  }}
                  title={`${employerMatchLabel}: ${formatCurrency(totalMatch)}${periodSuffix}`}
                />
              </>
            ) : (
              <div
                className={`${accountColor(categoryKey)} h-2 rounded-full`}
                style={{ width: "100%" }}
                title={`${formatCurrency(totalEmployee)}${periodSuffix}`}
              />
            )}
          </div>
          <div className="text-caption mt-0.5 flex justify-between">
            <span className="text-faint">No IRS limit</span>
            {jat.employerMatch > 0 && (
              <span className={`${accountTextColor(categoryKey)} font-medium`}>
                +{formatCurrency(totalMatch)}
                {periodSuffix} {employerMatchLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
