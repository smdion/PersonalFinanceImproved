/** The Roth-overlay tag, live and on restore: a retirement settings row
 *  saved before the overlay switch existed keeps the overlay it ran with. */
// No import from migration-converters.ts, which registers this one.
import { isEmpty, isRow, type Update } from "./converter-rows";

/** The Roth-overlay tag. */
export const ROTH_OVERLAY_TAG = "0022_v0111_roth_overlay";

/** The target every version before this tag read for an empty one. Frozen
 *  here: never DEFAULT_ROTH_BRACKET_TARGET, which may change later. */
const PRE_TAG_TARGET = "0.12";

// One gate, the switch (its own new column) being empty, never the target:
// a row set since the tag is never written again, so a replay writes nothing.
export const ROTH_OVERLAY_CONVERTER = {
  tables: ["retirement_settings"],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = [];
    let filled = 0;
    for (const row of (tables["retirement_settings"] ?? []).filter(isRow)) {
      if (!isEmpty(row["roth_bracket_overlay"])) continue;
      const emptyTarget = isEmpty(row["roth_bracket_target"]);
      if (emptyTarget) filled++;
      updates.push({
        table: "retirement_settings",
        id: Number(row["id"]),
        set: {
          roth_bracket_overlay: true,
          ...(emptyTarget ? { roth_bracket_target: PRE_TAG_TARGET } : {}),
        },
      });
    }
    return {
      updates,
      notes: [
        `${updates.length} retirement settings rows keep the Roth bracket overlay on, ${filled} of them with the 12% target they read`,
      ],
    };
  },
} as const;
