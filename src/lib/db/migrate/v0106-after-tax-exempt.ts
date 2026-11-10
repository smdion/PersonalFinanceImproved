/** The stored-JSON tag's after-tax deductions, live and on restore: an
 *  after-tax paycheck deduction flagged FICA-exempt loses the flag, which
 *  the paycheck math never applied to it. */
// No import from migration-converters.ts, which registers this one.
import { asBool, isRow, type Update } from "./converter-rows";

const DEDUCTIONS = "paycheck_deductions";

// Gated on two closed booleans (after-tax, flagged); clearing the flag is
// a projection, so a replay finds nothing to write.
export const AFTER_TAX_EXEMPT_CONVERTER = {
  tables: [DEDUCTIONS],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const updates: Update[] = (tables[DEDUCTIONS] ?? [])
      .filter(isRow)
      .filter(
        (d) =>
          asBool(d["is_pretax"]) === false && asBool(d["fica_exempt"]) === true,
      )
      .map((d) => ({
        table: DEDUCTIONS,
        id: Number(d["id"]),
        set: { fica_exempt: false },
      }));
    return {
      updates,
      notes: [
        `${updates.length} after-tax paycheck deductions cleared of the FICA-exempt flag`,
      ],
    };
  },
} as const;
