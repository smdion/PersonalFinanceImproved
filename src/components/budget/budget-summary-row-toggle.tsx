/** The budget summary's open/close toggle for an expanding row. */
import { ExpandRowButton } from "@/components/ui/expand-row-button";

/** The summary rows that open, by name; each one's toggle is labelled so. */
export const ROW_NAMES = {
  gross: "Gross Income",
  taxes: "Taxes",
  preTax: "Pre-Tax Deductions",
  postTax: "After-Tax Deductions",
  takeHome: "Take-Home Pay",
  savings: "Savings",
} as const;

export function RowToggle(p: { open: boolean; row: keyof typeof ROW_NAMES }) {
  return <ExpandRowButton expanded={p.open} label={ROW_NAMES[p.row]} />;
}
