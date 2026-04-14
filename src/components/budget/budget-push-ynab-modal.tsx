"use client";

/**
 * Thin wrapper around PushPreviewModal for the budget page's "Push to YNAB"
 * flow. Extracted from `src/app/(dashboard)/budget/page.tsx` during the v0.5.2
 * file-split refactor — pure relocation, no behavior changes.
 *
 * The parent owns the pushPreviewItems state + the tRPC syncToApi mutation;
 * this component is a presentational binding that wires the modal's
 * onConfirm/onCancel to the parent's close callback.
 */

import {
  PushPreviewModal,
  type PushPreviewItem,
} from "@/components/ui/push-preview-modal";

type Props = {
  items: PushPreviewItem[];
  activeColumnLabel: string | undefined;
  apiService: string | null | undefined;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function BudgetPushYnabModal({
  items,
  activeColumnLabel,
  apiService,
  isPending,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <PushPreviewModal
      title={`Push"${activeColumnLabel}" budget amounts to ${apiService?.toUpperCase()}`}
      items={items}
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={isPending}
    />
  );
}
