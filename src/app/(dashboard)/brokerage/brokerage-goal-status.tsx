/** The Brokerage page's goal funding status table. */
import { Badge } from "@/components/ui/badge";
import { HelpTip } from "@/components/ui/help-tip";
import { formatCurrency } from "@/lib/utils/format";
import { type BrokerageGoalStatus } from "@/lib/pure/savings/brokerage-goals";

export function GoalStatusTable({ goals }: { goals: BrokerageGoalStatus[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-faint border-b text-left text-xs uppercase">
            <th className="py-2 pr-4">Goal</th>
            <th className="py-2 pr-4 text-right">Target</th>
            <th className="py-2 pr-4 text-right">Year</th>
            <th className="py-2 pr-4 text-right">
              Projected Balance
              <HelpTip text="Estimated brokerage balance at target year, before the goal withdrawal" />
            </th>
            <th className="py-2 pr-4 text-right">Withdrawal</th>
            <th className="py-2 pr-4 text-right">
              Tax Cost
              <HelpTip text="Estimated capital gains tax on the gains portion of the withdrawal — basis (contributions) is tax-free" />
            </th>
            <th className="py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {goals.map((g) => (
            <tr key={g.id} className="border-subtle border-b">
              <td className="text-secondary py-2 pr-4 font-medium">{g.name}</td>
              <td className="text-muted py-2 pr-4 text-right">
                {formatCurrency(g.targetAmount)}
              </td>
              <td className="text-muted py-2 pr-4 text-right">
                {g.targetYear}
              </td>
              <td className="text-muted py-2 pr-4 text-right">
                {formatCurrency(g.projectedBalance)}
              </td>
              <td className="text-muted py-2 pr-4 text-right">
                {formatCurrency(g.actualWithdrawal)}
              </td>
              <td className="text-muted py-2 pr-4 text-right">
                {formatCurrency(g.taxCost)}
              </td>
              <td className="py-2 text-center">
                {g.funded ? (
                  <Badge color="green" size="sm" shape="pill" case="normal">
                    Funded
                  </Badge>
                ) : (
                  <Badge color="amber" size="sm" shape="pill" case="normal">
                    {formatCurrency(g.shortfall)} short
                  </Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
