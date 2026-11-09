import { z } from "zod/v4";

/**
 * Optional budget profile/column targeting for procedures reading
 * buildYearEndHistory/getAnnualExpensesFromBudget, instead of the active profile.
 * Omitting every field gives the untargeted, cacheable default.
 */
export const zYearEndTargeting = z
  .object({
    budgetProfileId: z.number().nullable().optional(),
    budgetColumn: z.number().nullable().optional(),
  })
  .optional();
