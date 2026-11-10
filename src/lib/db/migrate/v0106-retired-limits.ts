/** The stored-JSON tag's retired limits, live and on restore: a
 *  contribution_limits row whose limit_type Ledgr shipped and retired goes.
 *  Any other key, a household's own included, is kept. */
// No import from migration-converters.ts, which registers this one.
import { isRow } from "./converter-rows";
import type { RowDelete } from "./converter-writes";

const LIMITS = "contribution_limits";

/** limit_type keys Ledgr shipped and no code reads (from the seed and tax
 *  data history), as of this tag. Only ever grows. */
const RETIRED_LIMIT_TYPES: readonly string[] = ["roth_ira_magi_limit_mfj"];

// Deletes by an explicit retired list, a closed-set key, never by "not a
// key Ledgr knows": a replay finds nothing left to delete.
export const RETIRED_LIMITS_CONVERTER = {
  tables: [LIMITS],
  runs: "afterSql",
  rowCounts: { shrinks: [LIMITS] },
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const deletes: RowDelete[] = (tables[LIMITS] ?? [])
      .filter(isRow)
      .filter((r) => RETIRED_LIMIT_TYPES.includes(String(r["limit_type"])))
      .map((r) => ({ table: LIMITS, id: Number(r["id"]) }));
    return {
      updates: [],
      deletes,
      notes: [`${deletes.length} retired contribution limits deleted`],
    };
  },
} as const;
