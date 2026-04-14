"use client";

/**
 * Profile-level mutations for the budget page.
 * Extracted from `src/app/(dashboard)/budget/page.tsx` during the v0.5.2
 * file-split refactor. Pure relocation — no behavior changes.
 *
 * Covers: set-active, create, delete, rename. All simple-invalidate
 * mutations (onSuccess → invalidate queries). setActiveProfile busts
 * both listProfiles + computeActiveSummary because the active-profile
 * flip ripples through the summary query.
 */

import { trpc } from "@/lib/trpc";
import { useInvalidateBudget } from "./use-invalidate-budget";

export function useProfileMutations() {
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

  return { setActiveProfile, createProfile, deleteProfile, renameProfile };
}

export type ProfileMutations = ReturnType<typeof useProfileMutations>;
