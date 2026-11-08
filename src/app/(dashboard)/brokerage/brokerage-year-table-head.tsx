import { HelpTip } from "@/components/ui/help-tip";

/** The year-by-year table's header row, each column with its help tip. */
export function YearTableHead() {
  return (
    <thead className="bg-surface-primary sticky top-0 z-10">
      <tr className="text-caption text-faint border-b text-left uppercase">
        <th className="py-2 pr-3">Year</th>
        <th className="py-2 pr-3 text-right">
          Contribution
          <HelpTip text="Intentional brokerage contributions (employee + employer match). Hover for per-account breakdown." />
        </th>
        <th className="py-2 pr-3 text-right">
          Overflow
          <HelpTip text="Excess from retirement accounts that exceed IRS limits, redirected to brokerage" />
        </th>
        <th className="py-2 pr-3 text-right">
          Growth
          <HelpTip text="Investment returns — hover for return rate and per-account breakdown" />
        </th>
        <th className="py-2 pr-3 text-right">
          Withdrawals
          <HelpTip text="Goal withdrawals — hover for per-goal breakdown with tax cost" />
        </th>
        <th className="py-2 pr-3 text-right">
          Tax Cost
          <HelpTip text="Capital gains tax on the gains portion of withdrawals — basis is tax-free" />
        </th>
        <th className="py-2 pr-3 text-right">
          End Balance
          <HelpTip text="Total brokerage account value at year end — hover for breakdown" />
        </th>
      </tr>
    </thead>
  );
}
