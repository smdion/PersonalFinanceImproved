/** The paycheck summary (paycheck.computeSummary). Its input: the profile
 *  pair and tax year it prices under, and the What-If tab's edits. */
import { z } from "zod/v4";
import {
  zSandboxSalaryEntries,
  zSandboxDeductionEdits,
  zSandboxDeductionAdditions,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";

export const zPaycheckSummaryInput = z
  .object({
    taxYearOverride: z.number().int().min(2000).max(2100).optional(),
    contributionProfileId: z.number().int().optional(),
    salaryProfileId: z.number().int().optional(),
    /** The What-If tab's hand-edited salary/bonus entries — highest
     *  precedence tier, above the Salary Profile. See applySandboxSalaryEntries. */
    sandboxSalaryEntries: zSandboxSalaryEntries,
    /** The What-If tab's hand-edited amount for an existing deduction. */
    sandboxDeductionEdits: zSandboxDeductionEdits,
    /** The What-If tab's hand-added hypothetical deductions. */
    sandboxDeductionAdditions: zSandboxDeductionAdditions,
    /** The What-If tab's hand-edited contribution account values —
     *  one more layer on top of the picked Contribution Profile's own
     *  overrides, via the SAME applyContribActiveFields merge. */
    sandboxContribActiveFields: zSandboxContribActiveFields,
    /** The What-If tab's hand-added hypothetical contribution
     *  accounts — no DB row, personId-keyed. */
    sandboxContribAdditions: zSandboxContribAdditions,
  })
  .optional();
