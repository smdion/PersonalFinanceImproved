"use client";

import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "./use-persisted-setting";
import { SK_ACTIVE_SALARY_PROFILE_ID } from "@/lib/constants/settings-keys";

/**
 * Hook that reads the active Salary Profile ID from app_settings and keeps it
 * pointing at a real row.
 *
 * The setting is never a sentinel: the migration backfilled it to a real id,
 * and salaryProfile.delete refuses to remove the active or last-remaining
 * profile. This hook is the belt-and-braces repair for the case the setting
 * somehow names a row that is gone (a restored snapshot, a manual DB edit) —
 * it re-points at the oldest surviving profile rather than leaving null,
 * which no longer means anything.
 *
 * Twin of useActiveContribProfile — the two axes are independent, so a page
 * that previews under a different salary AND a different contribution setup
 * calls both.
 */
export function useActiveSalaryProfile(): [
  number | null,
  (id: number | null) => void,
] {
  const utils = trpc.useUtils();
  const setActive = trpc.salaryProfile.setActive.useMutation({
    // See useActiveContribProfile's matching docblock — switching the
    // active Salary Profile changes real input data for all of these, not
    // just the "which profile is active" pointer.
    onSuccess: () => {
      utils.settings.appSettings.list.invalidate();
      utils.salaryProfile.invalidate();
      utils.contribution.invalidate();
      utils.paycheck.invalidate();
      utils.projection.invalidate();
      utils.retirement.invalidate();
      utils.brokerage.invalidate();
      utils.budget.invalidate();
      utils.savings.invalidate();
      utils.settings.contributionAccounts.invalidate();
    },
  });
  const [activeId, setActiveId] = usePersistedSetting<number | null>(
    SK_ACTIVE_SALARY_PROFILE_ID,
    null,
    {
      writeVia: (id) => {
        if (id == null) return Promise.resolve();
        return setActive.mutateAsync({ id });
      },
    },
  );
  const { data: profiles } = trpc.salaryProfile.list.useQuery();

  // Re-point at a real row whenever the stored id names one that's gone (or
  // is absent entirely, e.g. a pre-migration snapshot restore).
  useEffect(() => {
    if (!profiles || profiles.length === 0) return;
    if (activeId != null && profiles.some((p) => p.id === activeId)) return;
    setActiveId(profiles[0]!.id);
  }, [activeId, profiles, setActiveId]);

  return [activeId, setActiveId];
}
