/** Shared TypeScript types, interfaces, and style constants for the budget API integration sub-components (YNAB/Actual). */

import type { BudgetApiService } from "@/lib/config/budget-apps";
import type { RouterOutputs } from "@/lib/trpc";

export type Service = BudgetApiService;

/** getPreview's result once the budget service has synced. */
export type PreviewData = Extract<
  RouterOutputs["sync"]["getPreview"],
  { synced: true }
>;

export type ApiCategoryOption = NonNullable<
  PreviewData["apiCategories"]
>[number];

export type BudgetMatch = NonNullable<PreviewData["budget"]>["matches"][number];

export const STATUS_STYLES = {
  linked: { bg: "bg-green-50", text: "text-green-700", label: "Linked" },
  suggested: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    label: "Suggested",
  },
  unmatched: {
    bg: "bg-surface-elevated",
    text: "text-faint",
    label: "No match",
  },
  // A stored id that matches no current API category (e.g. the budget was
  // re-imported upstream). Distinct from "unmatched", which was never linked.
  orphaned: {
    bg: "bg-red-50",
    text: "text-red-700",
    label: "Orphaned",
  },
} as const;
