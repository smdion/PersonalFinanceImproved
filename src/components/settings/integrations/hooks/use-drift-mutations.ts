"use client";

/**
 * Mutations for the drift-banner + profile header region of the integrations
 * preview panel. Covers bulk name-drift reconciliation and the
 * profile/column selectors that live at the very top of the panel.
 *
 * Isolated into its own hook so that a drift-mutation's pending flip does
 * not cause re-renders in the budget/savings/contrib/portfolio sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useDriftMutations() {
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

  return { syncAllNames, setLinkedProfile, setLinkedColumn, invalidate };
}

export type DriftMutations = ReturnType<typeof useDriftMutations>;
