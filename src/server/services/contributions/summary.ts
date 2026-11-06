/** The contribution summary (contribution.computeSummary). Its input: the
 *  profile pair and the What-If tab's contribution and salary edits. */
import { z } from "zod/v4";
import {
  zSandboxSalaryEntries,
  zSandboxContribActiveFields,
  zSandboxContribAdditions,
} from "@/lib/pure/household/what-if.schema";

export const zContributionSummaryInput = z
  .object({
    contributionProfileId: z.number().int().optional(),
    salaryProfileId: z.number().int().optional(),
    /** Sent with the paycheck summary's identical field, so the pay stub
     *  and the contribution cards agree. */
    sandboxSalaryEntries: zSandboxSalaryEntries,
    /** Sent with the paycheck summary's identical field, so the pay stub
     *  and the contribution cards agree. */
    sandboxContribActiveFields: zSandboxContribActiveFields,
    /** See the paycheck summary's identical field. */
    sandboxContribAdditions: zSandboxContribAdditions,
  })
  .optional();
