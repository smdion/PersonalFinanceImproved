"use client";

/**
 * The household's high-income line — the saved setting, else the default by
 * this year's filing status (contribution.highIncomeLine). Every savings
 * rate, the Checkup and the Milestones read it here. `threshold` is
 * undefined until known, so no surface shows a result for the wrong line.
 */
import { trpc } from "@/lib/trpc";
import { usePersistedSetting } from "@/lib/hooks/use-persisted-setting";
import { SK_HIGH_INCOME_THRESHOLD } from "@/lib/constants/settings-keys";
import {
  effectiveHighIncomeLine,
  type HighIncomeLineBasis,
} from "@/lib/pure/high-income-line";

export function useHighIncomeLine(): {
  threshold: number | undefined;
  /** What the default follows; null when the saved setting is used. */
  basis: HighIncomeLineBasis | null;
  defaultThreshold: number | undefined;
  setSaved: (value: number | null) => void;
} {
  const [saved, setSaved] = usePersistedSetting<number | null>(
    SK_HIGH_INCOME_THRESHOLD,
    null,
  );
  const { data } = trpc.contribution.highIncomeLine.useQuery(undefined, {
    staleTime: 60_000,
  });
  const threshold = effectiveHighIncomeLine(saved, data?.threshold);
  const isSaved = threshold !== undefined && threshold === saved;
  return {
    threshold,
    basis: isSaved ? null : (data?.basis ?? null),
    defaultThreshold: data?.threshold,
    setSaved,
  };
}
