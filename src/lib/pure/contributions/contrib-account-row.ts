/** The contribution account row the contribution summary's stages read. */
import type { AccountOwnership } from "@/lib/config/enum-values";
import type { CapPassed } from "./contribution-caps";
import type { PaycheckContribRow } from "./paycheck-contrib-row";

/** A contribution account once a profile's active fields and the cap pass
 *  apply: the fields the summary's stages read beyond the paycheck's. The
 *  services' resolved rows satisfy it structurally. */
export type ContribAccountRow = PaycheckContribRow &
  CapPassed & {
    ownership: AccountOwnership;
    performanceAccountId: number | null;
    targetAnnual: string | null;
    allocationPriority: number;
    priorYearContribAmount: string;
    priorYearContribYear: number | null;
  };
