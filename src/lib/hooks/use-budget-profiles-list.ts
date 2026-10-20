"use client";

import { trpc } from "@/lib/trpc";

/**
 * `budget.listProfiles`, called the one way the whole app calls it — each
 * profile's own "Unspent" figure is computed server-side from the active
 * Contribution/Salary profiles, so the query takes no input and every
 * caller shares one cache entry.
 */
export function useBudgetProfilesList() {
  return trpc.budget.listProfiles.useQuery();
}
