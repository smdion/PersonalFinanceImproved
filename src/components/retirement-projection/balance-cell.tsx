import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils/format";

/** A projection-table balance cell: the amount (display dollars) in its column
 *  color with a breakdown tooltip. Working-year and retirement rows each build
 *  their own tooltip (contributions vs withdrawals). */
export function BalanceCell({
  amount,
  color,
  tooltip,
}: {
  amount: number;
  color: string;
  tooltip?: ReactNode;
}) {
  return (
    <Tooltip content={tooltip} side="top">
      <td className={`px-2 py-1.5 text-right ${color}`}>
        {formatCurrency(amount)}
      </td>
    </Tooltip>
  );
}
