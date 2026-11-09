"use client";

/**
 * The household's high-income line — the saved setting, else the default by
 * this year's filing status (contribution.computeHighIncomeLine). Every savings
 * rate, the Checkup and the Milestones read it here. `threshold` is
 * undefined until known — the saved setting loaded, and the default when
 * nothing's saved — so no surface shows a result for the wrong line.
 * `error` is the default's load error when the line can't become known
 * (nothing's saved): callers show it, not a lasting skeleton.
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
