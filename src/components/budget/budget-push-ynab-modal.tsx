"use client";

/**
 * PushPreviewModal binding for "Push to YNAB"; the parent owns the items and
 * the syncToApi mutation.
 */

import { budgetApiServiceLabel } from "@/lib/utils/format";
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
      title={`Push "${activeColumnLabel}" budget amounts to ${budgetApiServiceLabel(apiService)}`}
      items={items}
      destinationLabel={budgetApiServiceLabel(apiService)}
      onConfirm={onConfirm}
      onCancel={onCancel}
      isPending={isPending}
    />
  );
}
