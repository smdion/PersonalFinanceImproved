// The Zod schemas for a projection request's profile selection, apart
// from profile-selection.ts so the client pages that build one skip Zod.
import { z } from "zod/v4";

/** One phase's spending: a Budget Profile and column, or a typed annual
 *  amount. A typed amount sets the total while the profile and column
 *  still date expense endings. */
const budgetSourceSchema = z
  .object({
    profileId: z.number().int().optional(),
    column: z.number().int().min(0).optional(),
    annualExpenses: z.number().min(0).optional(),
  })
  .strict();

export const profileSelectionSchema = z
  .object({
    salary: z.number().int().optional(),
    contribution: z.number().int().optional(),
    retirement: z.number().int().optional(),
    accumulationBudget: budgetSourceSchema.optional(),
    decumulationBudget: budgetSourceSchema.optional(),
  })
  .strict();

export type ProfileSelection = z.infer<typeof profileSelectionSchema>;

/** The picks a budget or savings request takes: its pay profiles. Null is
 *  "none": an active id still loading, or a Plan missing that kind. */
export const payProfileSelectionSchema = z
  .object({
    contribution: z.number().int().nullable().optional(),
    salary: z.number().int().nullable().optional(),
  })
  .strict();

export type PayProfileSelection = z.infer<typeof payProfileSelectionSchema>;
