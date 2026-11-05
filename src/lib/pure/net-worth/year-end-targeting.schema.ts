import { z } from "zod/v4";

/**
 * Optional "what-if" targeting for procedures that read through
 * buildYearEndHistory/getAnnualExpensesFromBudget — lets a caller (a
 * page-local profile picker) ask "what would this look like under budget
 * profile X, column Y" instead of always reading the globally-active budget
 * profile.
 * Every field is optional; omitting all of them reproduces the untargeted,
 * cacheable default behavior.
 */
export const zYearEndTargeting = z
  .object({
    budgetProfileId: z.number().nullable().optional(),
    budgetColumn: z.number().nullable().optional(),
  })
  .optional();
