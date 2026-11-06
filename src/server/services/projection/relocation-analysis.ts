/** The relocation analysis (retirement.computeRelocationAnalysis): its
 *  input, the two budget and contribution scenarios being compared. */
import { z } from "zod/v4";

export const zRelocationAnalysisInput = z.object({
  /** Profile ID + column index for current budget scenario. */
  currentProfileId: z.number().int(),
  currentBudgetColumn: z.number().int().min(0),
  /** Manual monthly expense override for current budget (overrides profile). */
  currentExpenseOverride: z.number().min(0).nullable().default(null),
  /** Profile ID + column index for relocation budget scenario. */
  relocationProfileId: z.number().int(),
  relocationBudgetColumn: z.number().int().min(0),
  /** Manual monthly expense override for relocation budget (overrides profile). */
  relocationExpenseOverride: z.number().min(0).nullable().default(null),
  /** Year-specific monthly expense overrides for the relocation scenario. */
  yearAdjustments: z
    .array(
      z.object({
        year: z.number().int(),
        monthlyExpenses: z.number(),
        profileId: z.number().int().optional(),
        budgetColumn: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  /** Year-specific contribution rate overrides (% of salary, sticky forward). */
  contributionOverrides: z
    .array(
      z.object({
        year: z.number().int(),
        rate: z.number().min(0).max(1),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  /** Large purchases tied to the relocation (home, car, furniture, etc.). */
  largePurchases: z
    .array(
      z.object({
        name: z.string(),
        purchasePrice: z.number().min(0),
        downPaymentPercent: z.number().min(0).max(1).optional(),
        loanRate: z.number().min(0).optional(),
        loanTermYears: z.number().int().min(0).optional(),
        ongoingMonthlyCost: z.number().min(0).optional(),
        saleProceeds: z.number().min(0).optional(),
        purchaseYear: z.number().int(),
      }),
    )
    .default([]),
  /** Contribution profile for current scenario (null = live DB). */
  currentContributionProfileId: z.number().int().nullable().default(null),
  /** Contribution profile for relocation scenario (null = live DB). */
  relocationContributionProfileId: z.number().int().nullable().default(null),
});
