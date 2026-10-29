import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils/format";

/** A balance column cell in the projection table (by tax type or by
 *  account): the amount in its column color with its breakdown tooltip.
 *  Shared by the working-year and retirement rows; each phase builds its
 *  own tooltip, since what moved a balance differs (contributions vs
 *  withdrawals). `amount` is already in display dollars. */
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
