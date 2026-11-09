"use client";

/**
 * PushPreviewModal binding for "Pull from YNAB": shows which local amounts the
 * API's goal targets will change. The parent owns the items and mutation.
 */

import { budgetApiServiceLabel } from "@/lib/config/display-labels";
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
      title={`Pull "${activeColumnLabel}" budget amounts from ${budgetApiServiceLabel(apiService)}`}
      items={items}
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={isPending}
      direction="pull"
      destinationLabel={budgetApiServiceLabel(apiService)}
    />
  );
}
