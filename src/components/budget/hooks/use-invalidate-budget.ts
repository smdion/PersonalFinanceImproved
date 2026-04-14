"use client";

/**
 * Shared base hook for budget page mutations.
 *
 * Returns a memoized `invalidateSummary` callback every per-section
 * mutation hook uses as its simple `onSuccess` handler, plus a
 * `invalidateSummaryAndProfiles` variant for the small set of mutations
 * that also need the listProfiles cache busted (column months, column
 * contribution profiles). Centralizing invalidation here avoids
 * duplicating the cache-busting logic across the five section hooks.
 *
 * Mirrors the proven pattern at
 * `src/components/settings/integrations/hooks/use-invalidate-preview.ts`.
 */

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export function useInvalidateBudget(): {
  invalidateSummary: () => void;
  invalidateSummaryAndProfiles: () => void;
  invalidateProfiles: () => void;
  invalidateSummaryAndSavings: () => void;
} {
  const utils = trpc.useUtils();

  const invalidateSummary = useCallback(() => {
    utils.budget.computeActiveSummary.invalidate();
  }, [utils]);

  const invalidateSummaryAndProfiles = useCallback(() => {
    utils.budget.computeActiveSummary.invalidate();
    utils.budget.listProfiles.invalidate();
  }, [utils]);

  const invalidateProfiles = useCallback(() => {
    utils.budget.listProfiles.invalidate();
  }, [utils]);

  const invalidateSummaryAndSavings = useCallback(() => {
    utils.budget.computeActiveSummary.invalidate();
    utils.savings.invalidate();
  }, [utils]);

  return {
    invalidateSummary,
    invalidateSummaryAndProfiles,
    invalidateProfiles,
    invalidateSummaryAndSavings,
  };
}
