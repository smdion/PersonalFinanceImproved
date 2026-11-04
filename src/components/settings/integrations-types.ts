/** Shared TypeScript types, interfaces, and style constants for the budget API integration sub-components (YNAB/Actual). */

import type { BudgetApiService } from "@/lib/config/enum-values";
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
  // A stored id that no longer resolves to any current API category — e.g.
  // the household's budget was rebuilt/re-imported upstream, regenerating
  // every category's id. Distinct from "unmatched" (never linked) so a
  // household can tell "needs a first link" apart from "was linked, broke
  // silently".
  orphaned: {
    bg: "bg-red-50",
    text: "text-red-700",
    label: "Orphaned",
  },
} as const;
