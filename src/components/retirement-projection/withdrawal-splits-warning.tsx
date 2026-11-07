/** The warning under the withdrawal splits when they don't total 100%. */
import type { AccountCategory } from "@/lib/config/account-types";
import { formatPercent } from "@/lib/utils/format";

/** The warning when the withdrawal splits don't total 100%. */
export function renderSplitsTotalWarning(
  displayedSplits: Record<AccountCategory, number>,
) {
  const total = Object.values(displayedSplits).reduce((s, v) => s + v, 0);
  const off = Math.abs(total - 1) > 0.001;
  return off ? (
    <p className="mt-1 text-xs text-amber-600">
      Splits total {formatPercent(total)} — should be 100%.
    </p>
  ) : null;
}
