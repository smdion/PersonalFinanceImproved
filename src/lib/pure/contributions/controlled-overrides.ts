/**
 * What-if runs vary some decumulation override fields over the saved Changes by year. Those
 * fields are removed from saved rows first, so a later sticky-forward row can't undo them.
 */
import type { DecumulationOverride } from "@/lib/pure/engine/types";

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
