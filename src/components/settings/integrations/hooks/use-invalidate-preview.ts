"use client";

/**
 * Shared base hook for the integrations preview panel.
 *
 * Returns a memoized `invalidatePreview` callback that every per-section
 * mutation hook uses as its `onSuccess` handler. Centralizing invalidation
 * here avoids duplicating the cache-busting logic across the 5 section hooks.
 */
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export function useInvalidatePreview(): () => void {
  const utils = trpc.useUtils();
  return useCallback(() => {
    utils.sync.getPreview.invalidate();
  }, [utils]);
}
