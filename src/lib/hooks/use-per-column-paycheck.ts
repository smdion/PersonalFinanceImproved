"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

type SalaryOverride = { personId: number; salary: number };

/** A column's profile pins — the two axes are independent, so both are part
 *  of the dedup key: two columns share a query only if they agree on BOTH. */
type ColumnPins = { contribId: number | null; salaryId: number | null };

const pinKey = (p: ColumnPins) => `${p.contribId}:${p.salaryId}`;

/**
 * Fetches paycheck summaries for up to 5 unique (Contribution Profile,
 * Salary Profile) pairs — one per budget column. Deduplicates queries so
 * that columns sharing both pins only trigger one fetch.
 *
 * Returns an array of paycheck results indexed by column, or null entries
 * while loading.
 */
export function usePerColumnPaycheck(
  perColumnProfileIds: (number | null)[],
  salaryOverrides: SalaryOverride[],
  perColumnSalaryProfileIds: (number | null)[] = [],
) {
  const perColumnPins: ColumnPins[] = useMemo(
    () =>
      perColumnProfileIds.map((contribId, i) => ({
        contribId,
        salaryId: perColumnSalaryProfileIds[i] ?? null,
      })),
    [perColumnProfileIds, perColumnSalaryProfileIds],
  );

  // Deduplicate pin pairs (preserve order for stable hook calls)
  const uniqueIds = useMemo(() => {
    const seen = new Set<string>();
    const result: ColumnPins[] = [];
    for (const pins of perColumnPins) {
      const key = pinKey(pins);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(pins);
      }
    }
    return result;
  }, [perColumnPins]);

  // Build query inputs for up to 5 unique pairs (padding with nulls for stable hook count)
  const buildInput = (pins: ColumnPins | null) => {
    const input: Record<string, unknown> = {};
    if (salaryOverrides.length > 0) input.salaryOverrides = salaryOverrides;
    if (pins?.contribId != null) input.contributionProfileId = pins.contribId;
    if (pins?.salaryId != null) input.salaryProfileId = pins.salaryId;
    return Object.keys(input).length > 0 ? input : undefined;
  };

  // Fixed number of hooks — React rules require stable hook count
  const q0 = trpc.paycheck.computeSummary.useQuery(
    buildInput(uniqueIds[0] ?? null) as never,
    { enabled: uniqueIds.length > 0 },
  );
  const q1 = trpc.paycheck.computeSummary.useQuery(
    buildInput(uniqueIds[1] ?? null) as never,
    { enabled: uniqueIds.length > 1 },
  );
  const q2 = trpc.paycheck.computeSummary.useQuery(
    buildInput(uniqueIds[2] ?? null) as never,
    { enabled: uniqueIds.length > 2 },
  );
  const q3 = trpc.paycheck.computeSummary.useQuery(
    buildInput(uniqueIds[3] ?? null) as never,
    { enabled: uniqueIds.length > 3 },
  );
  const q4 = trpc.paycheck.computeSummary.useQuery(
    buildInput(uniqueIds[4] ?? null) as never,
    { enabled: uniqueIds.length > 4 },
  );

  const queries = [q0, q1, q2, q3, q4];

  // Build a map from pin pair → query result
  return useMemo(() => {
    const dataByKey = new Map<string, typeof q0.data>();
    for (let i = 0; i < uniqueIds.length; i++) {
      const pins = uniqueIds[i];
      if (!pins) continue;
      dataByKey.set(pinKey(pins), queries[i]?.data ?? undefined);
    }
    // Map each column to its corresponding query result
    return perColumnPins.map((pins) => dataByKey.get(pinKey(pins)) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `queries` is omitted: new array ref every render; reactive content captured via q0.data–q4.data
  }, [perColumnPins, uniqueIds, q0.data, q1.data, q2.data, q3.data, q4.data]);
}
