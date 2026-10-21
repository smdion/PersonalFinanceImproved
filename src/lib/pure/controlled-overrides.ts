/**
 * What-if runs (tax optimization's comparisons, the bracket optimizer's
 * candidates) vary a few fields of the decumulation overrides on top of the
 * household's saved Changes by year. Overrides are sticky-forward per year,
 * so a saved row in a LATER year setting the same field would quietly undo
 * the what-if from that year on. The controlled fields win: they're removed
 * from the saved rows before the what-if rows are added.
 */
import type { DecumulationOverride } from "@/lib/calculators/types";

export function withControlledOverrides(
  saved: readonly DecumulationOverride[],
  controlled: readonly DecumulationOverride[],
): DecumulationOverride[] {
  const keys = new Set(
    controlled.flatMap((o) =>
      Object.keys(o).filter((k) => k !== "year" && k !== "notes"),
    ),
  );
  if (keys.size === 0) return [...saved, ...controlled];
  const stripped = saved
    .map(
      (o) =>
        Object.fromEntries(
          Object.entries(o).filter(([k]) => !keys.has(k)),
        ) as DecumulationOverride,
    )
    // A row left with nothing but its year (and notes) changes nothing.
    .filter((o) => Object.keys(o).some((k) => k !== "year" && k !== "notes"));
  return [...stripped, ...controlled];
}
