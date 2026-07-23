"use client";

/**
 * Thin wrapper around PushPreviewModal for the budget page's "Pull from YNAB"
 * flow — confirms which local budget amounts will change before applying the
 * API's goal targets.
 *
 * The parent owns the pullPreviewItems state + the tRPC syncFromApi mutation;
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

export function BudgetPullYnabModal({
  items,
  activeColumnLabel,
  apiService,
  isPending,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <PushPreviewModal
      title={`Pull "${activeColumnLabel}" budget amounts from ${apiService?.toUpperCase()}`}
      items={items}
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={isPending}
      direction="pull"
      destinationLabel={apiService?.toUpperCase() ?? "YNAB"}
    />
  );
}
