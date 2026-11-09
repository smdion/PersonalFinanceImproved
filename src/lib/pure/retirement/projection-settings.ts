/** The projection's saved-settings builders that read only their arguments. */

import { toNumber } from "@/lib/utils/numbers";
import {
  getAllStrategyKeys,
  getStrategyDefaults,
  getStrategyMeta,
  type WithdrawalStrategyType,
} from "@/lib/config/withdrawal-strategies";

/**
 * Baseline SS claiming age for the optimizer's ssStartAge lever: the earliest per-person
 * start age, since the household scalar `retirement_settings.ss_start_age` can be stale
 * for multi-person households (see build-engine-payload.ts); single-person uses the scalar.
 */
export function resolveSsStartAgeBaseline(
  perPersonSettings: ReadonlyArray<{ ssStartAge: number }> | undefined,
  baseEngineInputSsStartAge: number,
): number {
  return perPersonSettings && perPersonSettings.length > 1
    ? Math.min(...perPersonSettings.map((p) => p.ssStartAge))
    : baseEngineInputSsStartAge;
}

/**
 * Build strategyParams from DB settings columns: each strategy's config
 * defaults, with every param field read from its own column (config
 * `paramFields[].column`) when set. A null column keeps the default.
 */
export function buildStrategyParams(
  settings: Readonly<Record<string, unknown>>,
): Partial<Record<WithdrawalStrategyType, Record<string, number | boolean>>> {
  const out: Partial<
    Record<WithdrawalStrategyType, Record<string, number | boolean>>
  > = {};
  for (const key of getAllStrategyKeys()) {
    const meta = getStrategyMeta(key);
    if (meta.paramFields.length === 0) continue;
    const params: Record<string, number | boolean> = getStrategyDefaults(key);
    for (const field of meta.paramFields) {
      const stored = settings[field.column];
      if (stored == null) continue;
      params[field.key] =
        field.type === "boolean" ? Boolean(stored) : toNumber(String(stored));
    }
    out[key] = params;
  }
  return out;
}
