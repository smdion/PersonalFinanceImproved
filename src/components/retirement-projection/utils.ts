/** Display constants and styling for the projection card: Roth conversion bracket presets, tooltip accent colors, account-category labels, the advisor-shared tooltip text, and strategy event marker styles. */
import {
  getAllCategories,
  getAccountTypeConfig,
} from "@/lib/config/account-types";
import { formatPercent } from "@/lib/utils/format";
import { CHART_COLORS } from "@/lib/utils/colors";
import type { TipColor } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Roth conversion target bracket presets for the decumulation form dropdown. */
export const ROTH_CONVERSION_BRACKET_PRESETS = [
  "0",
  "0.1",
  "0.12",
  "0.22",
  "0.24",
  "0.32",
  "0.35",
];

// Tooltip accent colors for every projection tooltip. Tooltip surfaces are always dark,
// so these are STATIC shades with no `--c-*` override in globals.css (red-400 is remapped
// but still reads on dark). Theme-adaptive surfaces use `--c-*` classes, not this map.
export const tipColorClass: Record<TipColor, string> = {
  green: "text-green-400",
  blue: "text-blue-400",
  red: "text-red-400",
  amber: "text-amber-400",
  emerald: "text-emerald-300",
  violet: "text-violet-400",
  gray: "text-slate-400", // matches this feature's own pre-existing muted/neutral convention (tooltip-renderer.tsx's meta/meta2/tax-split lines)
  teal: "text-teal-400", // SS accent
  purple: "text-purple-300", // MC accent
};

/** Display label for an account category. */
export const catDisplayLabel: Record<string, string> = Object.fromEntries(
  getAllCategories().map((cat) => [
    cat,
    getAccountTypeConfig(cat).displayLabel,
  ]),
);

// --- Shared calculation helpers ---

// Re-exported from lib/pure so the advisor report and the tooltip call sites
// share one implementation.
export {
  formatDiscretionaryTierBreakdown,
  formatRmdDivisorDetail,
} from "@/lib/pure/advice/report/withdrawal-strategy-narrative";

// ---------------------------------------------------------------------------
// Guardrail/strategy event styling, shared by chart markers and table tooltip.
// ---------------------------------------------------------------------------

type StrategyEventStyle = {
  color: string;
  label: string;
  tooltipText: string;
};

/** Per-strategy spending-adjustment event styling, keyed by
 *  `EngineDecumulationYear.strategyAction`. Percent context comes from the
 *  household's own settings (the % actually applied that year). */
export function buildStrategyEventStyle(
  engineSettings:
    | {
        withdrawalStrategy?: string | null;
        gkIncreasePct?: string | number | null;
        gkDecreasePct?: string | number | null;
        vdCeilingPercent?: string | number | null;
        vdFloorPercent?: string | number | null;
        cpFloorPercent?: string | number | null;
        enFloorPercent?: string | number | null;
      }
    | null
    | undefined,
): Record<string, StrategyEventStyle> {
  const pct = (v: unknown) => (v != null ? formatPercent(Number(v), 0) : null);
  const gkIncreasePct = pct(engineSettings?.gkIncreasePct);
  const gkDecreasePct = pct(engineSettings?.gkDecreasePct);
  const vdCeilingPercent = pct(engineSettings?.vdCeilingPercent);
  const vdFloorPercent = pct(engineSettings?.vdFloorPercent);
  const cpFloorPercent = pct(engineSettings?.cpFloorPercent);
  const enFloorPercent = pct(engineSettings?.enFloorPercent);
  const activeStrategy = engineSettings?.withdrawalStrategy;

  return {
    increase: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: gkIncreasePct ? `▲ raise +${gkIncreasePct}` : "▲ raise",
      tooltipText: `Upper guardrail triggered — spending raised${gkIncreasePct ? ` ${gkIncreasePct}` : ""}`,
    },
    decrease: {
      color: CHART_COLORS.guardrailDecreaseMarker,
      label: gkDecreasePct ? `▼ cut -${gkDecreasePct}` : "▼ cut",
      tooltipText: `Lower guardrail triggered — spending cut${gkDecreasePct ? ` ${gkDecreasePct}` : ""}`,
    },
    skip_inflation: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label: "⏸ no raise",
      tooltipText:
        "Withdrawal rule — inflation raise skipped after a loss year",
    },
    ceiling_applied: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: vdCeilingPercent ? `▲ capped @${vdCeilingPercent}` : "▲ capped",
      tooltipText: `Year-over-year ceiling reached${vdCeilingPercent ? ` (max +${vdCeilingPercent}/yr)` : ""} — raise capped, spending still rose just not as much as your balance alone would set`,
    },
    vpw_cap: {
      color: CHART_COLORS.guardrailIncreaseMarker,
      label: "▲ at cap",
      tooltipText:
        "VPW's percentage has reached its cap — it holds there from now on",
    },
    floor_applied: {
      color: CHART_COLORS.guardrailSkipInflationMarker,
      label:
        activeStrategy === "vanguard_dynamic" && vdFloorPercent
          ? `▼ floor @${vdFloorPercent}`
          : "▼ floor",
      tooltipText:
        activeStrategy === "vanguard_dynamic"
          ? `Year-over-year floor reached${vdFloorPercent ? ` (max -${vdFloorPercent}/yr)` : ""} — cut limited, spending still fell just not as much as your balance alone would set`
          : `Nominal floor reached${
              activeStrategy === "endowment"
                ? enFloorPercent
                  ? ` (${enFloorPercent} of your initial withdrawal)`
                  : ""
                : cpFloorPercent
                  ? ` (${cpFloorPercent} of your initial withdrawal)`
                  : ""
            } — spending held at the floor instead of following your balance down further`,
    },
  };
}
