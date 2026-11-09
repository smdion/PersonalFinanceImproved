"use client";

/**
 * Tracking-account-mapping mutations (bulk mapping updates, assets from unmapped remote accounts).
 * A separate hook so a pending flip doesn't re-render other sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useIntegrationPortfolioMutations() {
  const invalidate = useInvalidatePreview();

  const updateMappings = trpc.sync.updateAccountMappings.useMutation({
    onSuccess: invalidate,
  });
  const createAssetAndMap = trpc.sync.createAssetAndMap.useMutation({
    onSuccess: invalidate,
  });

  return { updateMappings, createAssetAndMap };
}

export type IntegrationPortfolioMutations = ReturnType<
  typeof useIntegrationPortfolioMutations
>;
