/** The input of the active budget summary (budget.computeActiveSummary):
 *  the profile and column, the pay pair, and the What-If tab's edits. */
import { z } from "zod/v4";
import { payProfileSelectionSchema } from "@/lib/pure/household/profile-selection.schema";
import {
  zSandboxSalaryEntries,
  zItemAmountActiveFields,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";

export const zBudgetActiveSummaryInput = z
  .object({
    selectedColumn: z.number().optional(),
    profileId: z.number().optional(),
    /** The page's own Contribution/Salary picks (What-If); absent =
     *  the active profiles. */
    selection: payProfileSelectionSchema.optional(),
    /** The What-If tab's salary/bonus entries, as in zPaycheckSummaryInput:
     *  every paycheck summary this computes reads them (linked amounts and
     *  netMonthlyIncome), so both see the same income. */
    sandboxSalaryEntries: zSandboxSalaryEntries,
    /** The What-If tab's budget item amounts, one more layer on the
     *  per-item resolution chain (see toItemAmountActiveMap). */
    itemAmountActiveFields: zItemAmountActiveFields,
    /** As in zPaycheckSummaryInput; they reach netMonthlyIncome's paycheck
     *  summary, so a deduction edit moves the income the budget is checked
     *  against. */
    sandboxDeductionEdits: zSandboxDeductionEdits,
    sandboxDeductionAdditions: zSandboxDeductionAdditions,
    /** As in zPaycheckSummaryInput; applied to linked-item resolution and
     *  to netMonthlyIncome's paycheck summary alike. */
    sandboxContribActiveFields: zSandboxContribActiveFields,
    /** As in zPaycheckSummaryInput. */
    sandboxContribAdditions: zSandboxContribAdditions,
  })
  .optional();
