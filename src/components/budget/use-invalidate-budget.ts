"use client";

/**
 * Shared cache invalidation for the budget mutation hooks: `invalidateSummary`
 * plus variants that also bust profiles or contribution-dependent routers.
 */

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export function useInvalidateBudget(): {
  invalidateSummary: () => void;
  invalidateSummaryAndProfiles: () => void;
  invalidateProfiles: () => void;
  invalidateSummaryAndContributions: () => void;
} {
  const utils = trpc.useUtils();

  // Item changes can shift API-actuals matching and the e-fund target (sums
  // essential items); every other invalidate* variant builds on this one.
  const invalidateSummary = useCallback(() => {
    utils.budget.computeActiveSummary.invalidate();
    utils.budget.listApiActuals.invalidate();
    utils.savings.invalidate();
  }, [utils]);

  const invalidateSummaryAndProfiles = useCallback(() => {
    invalidateSummary();
    utils.budget.listProfiles.invalidate();
  }, [utils, invalidateSummary]);

  const invalidateProfiles = useCallback(() => {
    utils.budget.listProfiles.invalidate();
  }, [utils]);

  // Linked-item amount edits write contribution_accounts, read by many
  // routers; bust them all so the edit shows everywhere.
  const invalidateSummaryAndContributions = useCallback(() => {
    invalidateSummary();
    utils.paycheck.invalidate();
    utils.contribution.invalidate();
    utils.retirement.invalidate();
    utils.projection.invalidate();
    utils.brokerage.invalidate();
    utils.settings.contributionAccounts.invalidate();
  }, [utils, invalidateSummary]);

  return {
    invalidateSummary,
    invalidateSummaryAndProfiles,
    invalidateProfiles,
    invalidateSummaryAndContributions,
  };
}
