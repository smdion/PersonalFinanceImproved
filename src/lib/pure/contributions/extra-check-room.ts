/** A year's extra payday (a 27th or 53rd check): what an account's checks past the ones its
 *  yearly money covers may take. Payroll stops at the IRS limit. */
import type { ContributionMethod } from "@/lib/config/enum-values";
import type { CapPassed } from "./contribution-caps";
import type { CheckBasis } from "@/lib/pure/paycheck/year-paydays";

/** The person's room left in the row's limit group, as the cap pass sized it over all their rows:
 *  their most, less their other rows there (as configured) and this row's capped money. */
function roomLeft(most: number, others: number, capped: number): number {
  return Math.max(0, most - others - capped);
}

/** A row's covered checks (a fixed per-check amount: the periods; the rest: the divisor) and its
 *  group's room past them; none when the year has no check past them. */
export function extraCheckFields(
  row: CapPassed & { contributionMethod: ContributionMethod | null },
  basis: CheckBasis,
) {
  const coveredChecks =
    row.contributionMethod === "fixed_per_period"
      ? basis.periodsPerYear
      : basis.salaryDivisor;
  if (basis.paydays === undefined || basis.paydays <= coveredChecks) return {};
  const group = row.cap?.group;
  return {
    coveredChecks,
    ...(group &&
    row.cap &&
    row.cap.maxEmployee !== null &&
    row.othersInGroup !== undefined
      ? {
          extraCheckLimit: {
            group,
            room: roomLeft(
              row.cap.maxEmployee,
              row.othersInGroup,
              row.cap.cappedAnnual,
            ),
          },
        }
      : {}),
  };
}
