"use client";

import { trpc } from "@/lib/trpc";

/**
 * `budget.listProfiles` with no input (Unspent is computed server-side from the
 * active profiles), so every caller shares one cache entry.
 */
export function useBudgetProfilesList() {
  return trpc.budget.listProfiles.useQuery();
}
