"use client";

/**
 * Mutations linking a budget item to a non-payroll contribution account for push sync.
 * A separate hook so a pending flip doesn't re-render other sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useIntegrationContributionAccountMutations() {
  const invalidate = useInvalidatePreview();

  const linkContrib = trpc.budget.linkContributionAccount.useMutation({
    onSuccess: invalidate,
  });
  const unlinkContrib = trpc.budget.unlinkContributionAccount.useMutation({
    onSuccess: invalidate,
  });

  return { linkContrib, unlinkContrib };
}
