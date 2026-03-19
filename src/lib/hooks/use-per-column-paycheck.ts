import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

type SalaryOverride = { personId: number; salary: number };

/**
 * Fetches paycheck summaries for up to 5 unique contribution profile IDs
 * (one per budget column). Deduplicates queries so that columns sharing
 * a profile only trigger one fetch.
 *
 * Returns an array of paycheck results indexed by column, or null entries
 * while loading.
 */
export function usePerColumnPaycheck(
  perColumnProfileIds: (number | null)[],
  salaryOverrides: SalaryOverride[],
) {
  // Deduplicate profile IDs (preserve order for stable hook calls)
  const uniqueIds = useMemo(() => {
    const seen = new Set<string>();
    const result: (number | null)[] = [];
    for (const id of perColumnProfileIds) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(id);
      }
    }
    return result;
  }, [perColumnProfileIds]);

  // Build query inputs for up to 5 unique profiles (padding with nulls for stable hook count)
  const buildInput = (profileId: number | null) => {
    const input: Record<string, unknown> = {};
    if (salaryOverrides.length > 0) input.salaryOverrides = salaryOverrides;
    if (profileId != null) input.contributionProfileId = profileId;
    return Object.keys(input).length > 0 ? input : undefined;
  };

  // Fixed number of hooks — React rules require stable hook count
  const q0 = trpc.paycheck.getSummary.useQuery(
    buildInput(uniqueIds[0] ?? null) as never,
    { enabled: uniqueIds.length > 0 },
  );
  const q1 = trpc.paycheck.getSummary.useQuery(
    buildInput(uniqueIds[1] ?? null) as never,
    { enabled: uniqueIds.length > 1 },
  );
  const q2 = trpc.paycheck.getSummary.useQuery(
    buildInput(uniqueIds[2] ?? null) as never,
    { enabled: uniqueIds.length > 2 },
  );
  const q3 = trpc.paycheck.getSummary.useQuery(
    buildInput(uniqueIds[3] ?? null) as never,
    { enabled: uniqueIds.length > 3 },
  );
  const q4 = trpc.paycheck.getSummary.useQuery(
    buildInput(uniqueIds[4] ?? null) as never,
    { enabled: uniqueIds.length > 4 },
  );

  const queries = [q0, q1, q2, q3, q4];

  // Build a map from profile ID → query result
  return useMemo(() => {
    const dataByKey = new Map<string, typeof q0.data>();
    for (let i = 0; i < uniqueIds.length; i++) {
      const key = String(uniqueIds[i]);
      dataByKey.set(key, queries[i]?.data ?? undefined);
    }
    // Map each column to its corresponding query result
    return perColumnProfileIds.map((id) => dataByKey.get(String(id)) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    perColumnProfileIds,
    uniqueIds,
    q0.data,
    q1.data,
    q2.data,
    q3.data,
    q4.data,
  ]);
}
