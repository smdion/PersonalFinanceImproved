"use client";

/**
 * ExtraPaycheckBudgetNote
 *
 * Plain informational text for the Budget page: which biweekly jobs have an
 * extra paycheck NOT routed to a savings goal (the "Budget" toggle on the
 * Savings page's extra-paycheck editor), and which upcoming months to expect
 * it in. Purely a display note — it does not add anything to the Budget
 * page's computed totals. See RULES.md's extraPaycheckRouting section:
 * actually folding this into the live budget totals (smoothed average or a
 * discrete monthly bump) is a follow-up, not done here.
 */

import { trpc } from "@/lib/trpc";
import { formatCurrency, MONTH_NAMES_SHORT } from "@/lib/utils/format";
import {
  getExtraPaycheckMonthKeys,
  isExtraPaycheckBudgetMode,
} from "@/lib/calculators/paycheck";

const HORIZON_MONTHS = 12;

function fmtMonth(mk: string): string {
  const [y, m] = mk.split("-");
  return `${MONTH_NAMES_SHORT[parseInt(m!) - 1]} ${y}`;
}

export function ExtraPaycheckBudgetNote() {
  const { data: jobs } = trpc.savings.extraPaycheckRouting.list.useQuery();

  if (!jobs || jobs.length === 0) return null;

  const now = new Date();
  const asOf = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));

  const entries = jobs
    .filter((j) => j.payPeriod === "biweekly" && j.anchorPayDate)
    .filter((j) => isExtraPaycheckBudgetMode(j.extraPaycheckRouting))
    .map((j) => {
      const anchor = new Date(j.anchorPayDate! + "T00:00:00Z");
      const months = getExtraPaycheckMonthKeys(
        anchor,
        j.payPeriod!,
        asOf,
        HORIZON_MONTHS,
      );
      return {
        jobId: j.id,
        personName: j.personName,
        employerName: j.employerName,
        months,
        amount: j.extraPaycheckRouting?.baseNetPayPerCheck,
      };
    })
    .filter((e) => e.months.length > 0);

  if (entries.length === 0) return null;

  return (
    <div className="rounded border border-subtle bg-surface-sunken/30 px-3 py-2 text-xs text-muted space-y-1">
      <p className="font-medium text-secondary">
        Extra paychecks not routed to savings
      </p>
      {entries.map((e) => (
        <p key={e.jobId}>
          {e.personName} ({e.employerName}):{" "}
          {e.amount != null
            ? `${formatCurrency(e.amount)} expected`
            : "an extra check expected"}{" "}
          in {e.months.map(fmtMonth).join(", ")} — lands as regular income, not
          counted in the totals above.
        </p>
      ))}
    </div>
  );
}
