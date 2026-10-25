"use client";

import type { RothIraRoute } from "@/lib/config/enum-values";

/** How a Roth IRA contribution gets there: direct, or the backdoor (a
 *  non-deductible traditional IRA contribution converted to the Roth). The
 *  account stays a Roth contribution either way; the route tells the Roth
 *  IRA income check whether the limit applies. */
export function RothRouteSelect({
  value,
  disabled,
  onChange,
}: {
  value: RothIraRoute | undefined;
  disabled?: boolean;
  onChange: (route: RothIraRoute) => void;
}) {
  return (
    <label className="text-caption text-faint inline-flex items-center gap-1">
      Gets to the Roth:
      <select
        value={value ?? "direct"}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as RothIraRoute)}
        className="text-caption text-secondary cursor-pointer border-none bg-transparent focus:outline-none"
        title="Direct: contributed straight to the Roth IRA (income limit applies). Backdoor: contributed to a traditional IRA, then converted (works at any income)."
      >
        <option value="direct">Direct</option>
        <option value="backdoor">
          Backdoor (converted from a traditional IRA)
        </option>
      </select>
    </label>
  );
}
