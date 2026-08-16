/**
 * Shared conventions for tRPC routers.
 *
 * ──────────────────────────────────────────────────────────
 * NUMERIC / DECIMAL COLUMN RETURN TYPES
 * ──────────────────────────────────────────────────────────
 *
 * Drizzle returns PostgreSQL NUMERIC(12,2) columns as `string` by default
 * to preserve decimal precision. This is intentional — JavaScript `number`
 * (IEEE 754 float64) can silently lose precision with large currency values
 * (e.g. 9_999_999_999.99 cannot be represented exactly as a float).
 *
 * Convention:
 *  - DB → tRPC response: NUMERIC columns arrive as `string` (e.g. "1234.56").
 *  - Server helpers use `toNumber()` from `@/server/helpers/transforms` to parse
 *    strings to numbers when doing arithmetic (see that module for details).
 *  - Client code should use `parseFloat(value)` or `Number(value)` when it
 *    needs a numeric value for calculations, charts, or formatting.
 *  - When writing back to the DB, convert with `.toFixed(2)` to produce a
 *    string that PostgreSQL accepts for NUMERIC columns.
 *
 * This is a deliberate trade-off: we accept minor ergonomic friction on the
 * client in exchange for zero silent precision loss across the full stack.
 * A blanket refactor to coerce everything to `number` in tRPC output schemas
 * would risk introducing rounding bugs in balances and transaction amounts.
 * ──────────────────────────────────────────────────────────
 */

// This file is intentionally declaration-only (documentation + re-exports).
// Import shared utilities from their canonical locations:
//   toNumber()           → @/server/helpers/transforms
//   zDecimal             → @/server/routers/settings/_shared
//   protectedProcedure   → @/server/trpc

import { z } from "zod/v4";

/**
 * Optional "what-if" targeting for procedures that read through
 * buildYearEndHistory/getAnnualExpensesFromBudget — lets a caller (a Plan
 * pin, or a page-local profile picker) ask "what would this look like under
 * budget profile X, column Y, with these salary overrides" instead of always
 * reading the globally-active budget profile and true DB salaries.
 * Every field is optional; omitting all of them reproduces the untargeted,
 * cacheable default behavior.
 */
export const zYearEndTargeting = z
  .object({
    budgetProfileId: z.number().nullable().optional(),
    budgetColumn: z.number().nullable().optional(),
    salaryOverrides: z
      .array(z.object({ personId: z.number(), salary: z.number() }))
      .optional(),
  })
  .optional();

export type YearEndTargetingInput = z.infer<typeof zYearEndTargeting>;

/** Convert a procedure's `salaryOverrides` input array into the Map shape helpers expect. */
export function toSalaryOverrideMap(
  salaryOverrides: { personId: number; salary: number }[] | undefined,
): Map<number, number> {
  return new Map((salaryOverrides ?? []).map((s) => [s.personId, s.salary]));
}
