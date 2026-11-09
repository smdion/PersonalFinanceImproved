"use client";

/**
 * Mutations for the preview panel header: bulk name-drift reconciliation and the profile/column
 * selectors. A separate hook so a pending flip doesn't re-render other sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useIntegrationDriftMutations() {
  const invalidate = useInvalidatePreview();

  const syncAllNames = trpc.sync.syncAllNames.useMutation({
    onSuccess: invalidate,
  });
  const setLinkedProfile = trpc.sync.setLinkedProfile.useMutation({
    onSuccess: invalidate,
  });
  const setLinkedColumn = trpc.sync.setLinkedColumn.useMutation({
    onSuccess: invalidate,
  });

  return { syncAllNames, setLinkedProfile, setLinkedColumn };
}
