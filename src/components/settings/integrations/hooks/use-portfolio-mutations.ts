"use client";

/**
 * Mutations for the portfolio → tracking-account-mapping section of the
 * integrations preview panel. Covers bulk mapping updates and asset
 * creation from unmapped remote tracking accounts.
 *
 * Isolated into its own hook so that a portfolio mutation's pending flip
 * does not cause re-renders in the budget/savings/contrib sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function usePortfolioMutations() {
  const invalidate = useInvalidatePreview();

  const updateMappings = trpc.sync.updateAccountMappings.useMutation({
    onSuccess: invalidate,
  });
  const createAssetAndMap = trpc.sync.createAssetAndMap.useMutation({
    onSuccess: invalidate,
  });

  return { mutations: { updateMappings, createAssetAndMap }, invalidate };
}

export type PortfolioMutations = ReturnType<
  typeof usePortfolioMutations
>["mutations"];
