"use client";

/**
 * The household's high-income line: the saved setting, else the default by
 * filing status. `threshold` is undefined until known; `error` is the default's
 * load error when nothing's saved, for callers to show instead of a skeleton.
 */
import { trpc, type RouterError } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_HIGH_INCOME_THRESHOLD } from "@/lib/constants/settings-keys";
import {
  effectiveHighIncomeLine,
  type HighIncomeLineBasis,
} from "@/lib/pure/paycheck/high-income-line";

export function useHighIncomeLine(): {
  threshold: number | undefined;
  /** What the default follows; null when the saved setting is used. */
  basis: HighIncomeLineBasis | null;
  defaultThreshold: number | undefined;
  setSaved: (value: number | null) => void;
  error: RouterError | null;
  /** The line isn't known yet and hasn't failed (QueryBoundary reads these). */
  isLoading: boolean;
  refetch: () => void;
} {
  const [saved, setSaved, loaded] = usePersistedSetting<number | null>(
    SK_HIGH_INCOME_THRESHOLD,
    null,
  );
  const { data, error, refetch } =
    trpc.contribution.computeHighIncomeLine.useQuery(undefined, {
      staleTime: 60_000,
    });
  const threshold = loaded
    ? effectiveHighIncomeLine(saved, data?.threshold)
    : undefined;
  const isSaved = threshold !== undefined && threshold === saved;
  return {
    threshold,
    basis: isSaved ? null : (data?.basis ?? null),
    defaultThreshold: data?.threshold,
    setSaved,
    error: threshold === undefined ? error : null,
    isLoading: threshold === undefined && !error,
    refetch: () => void refetch(),
  };
}
