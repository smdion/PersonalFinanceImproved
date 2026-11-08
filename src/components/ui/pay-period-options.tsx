import { PAY_PERIOD_VALUES } from "@/lib/config/enum-values";
import { PAY_PERIOD_LABELS } from "@/lib/config/display-labels";

/** A pay-period picker's options, each pay period with its label. */
export function PayPeriodOptions() {
  return PAY_PERIOD_VALUES.map((v) => (
    <option key={v} value={v}>
      {PAY_PERIOD_LABELS[v]}
    </option>
  ));
}
