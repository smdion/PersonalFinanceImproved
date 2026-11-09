"use client";

/** Memoized `invalidatePreview`, the `onSuccess` handler of every integrations section hook. */
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export function useInvalidatePreview(): () => void {
  const utils = trpc.useUtils();
  return useCallback(() => {
    utils.sync.getPreview.invalidate();
  }, [utils]);
}
