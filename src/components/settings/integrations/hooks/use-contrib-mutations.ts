"use client";

/**
 * Mutations for the non-payroll contribution-account-linking section of
 * the integrations preview panel. Covers linking/unlinking a Ledgr budget
 * item to a contribution account (e.g. 401k, HSA) for push-side sync.
 *
 * Isolated into its own hook so that a contrib mutation's pending flip
 * does not cause re-renders in the budget/savings/portfolio sections.
 */
import { trpc } from "@/lib/trpc";
import { useInvalidatePreview } from "./use-invalidate-preview";

export function useContribMutations() {
  const invalidate = useInvalidatePreview();

  const linkContrib = trpc.budget.linkContributionAccount.useMutation({
    onSuccess: invalidate,
  });
  const unlinkContrib = trpc.budget.unlinkContributionAccount.useMutation({
    onSuccess: invalidate,
  });

  return { linkContrib, unlinkContrib, invalidate };
}

export type ContribMutations = ReturnType<typeof useContribMutations>;
