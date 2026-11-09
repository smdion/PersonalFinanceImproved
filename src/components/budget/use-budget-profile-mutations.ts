"use client";

/**
 * Budget profile mutations: each invalidates listProfiles on success;
 * set-active also busts computeActiveSummary.
 */

import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useBudgetProfileMutations() {
  const { invalidateProfiles, invalidateSummaryAndProfiles } =
    useInvalidateBudget();

  const setActiveProfile = trpc.budget.setActiveProfile.useMutation({
    onSuccess: invalidateSummaryAndProfiles,
  });
  const createProfile = trpc.budget.createProfile.useMutation({
    onSuccess: invalidateProfiles,
  });
  const deleteProfile = trpc.budget.deleteProfile.useMutation({
    onSuccess: invalidateProfiles,
  });
  const renameProfile = trpc.budget.renameProfile.useMutation({
    onSuccess: invalidateProfiles,
  });
  const duplicateProfile = trpc.budget.duplicateProfile.useMutation({
    onSuccess: invalidateProfiles,
  });

  return {
    setActiveProfile,
    createProfile,
    deleteProfile,
    renameProfile,
    duplicateProfile,
  };
}
