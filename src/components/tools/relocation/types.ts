/** Shared prop types for relocation sub-components extracted from tools/page.tsx.
 *
 * These shapes mirror what `trpc.retirement.computeRelocationAnalysis` returns.
 * They are hand-written (rather than inferred via `inferRouterOutputs`)
 * because `src/components/**` is lint-forbidden from importing `@/server/*`.
 * Keep in sync with `src/server/routers/retirement.ts::computeRelocationAnalysis`.
 */

// The calculator-side result type lives in `lib/` and is the authoritative
// shape for `relocQuery.data.result`. Re-exporting lets us keep lib imports
// local to this module.
import type { RelocationResult as CalculatorRelocationResult } from "@/lib/calculators/types/relocation";

/** Budget profile summary entry within `budgetInfo.profiles`. Server builds
 *  this from `budgetProfiles` rows — shape: retirement.ts profileSummaries.
 */
export type RelocationBudgetProfile = {
  id: number;
  name: string;
  isActive: boolean;
  columnLabels: string[];
  columnMonths: number[] | null;
  columnTotals: number[];
  weightedAnnualTotal: number | null;
};

/** `budgetInfo` payload (non-null branch). */
export type RelocationBudgetInfo = {
  profiles: RelocationBudgetProfile[];
  currentProfileId: number;
  currentColumnIndex: number;
  relocationProfileId: number;
  relocationColumnIndex: number;
};

/** Contribution profile summary returned on the top-level query result
 *  (see `retirement.ts::currentContribProfile` / `relocationContribProfile`).
 */
export type RelocationContribProfile = {
  annualContributions: number;
  employerMatch: number;
  combinedSalary: number;
};

/** Re-export of the calculator `RelocationResult` under the local name so
 *  leaf components can import everything from one module.
 */
export type RelocationResult = CalculatorRelocationResult;

/** Year-adjustment UI row (client-side only — server doesn't round-trip `id`). */
export type YearAdjustmentRow = {
  id: string;
  year: number;
  monthlyExpenses: number;
  profileId?: number;
  budgetColumn?: number;
  notes?: string;
};

/** Large-purchase UI row (client-side only — server doesn't round-trip `id`). */
export type LargePurchaseRow = {
  id: string;
  name: string;
  purchasePrice: number;
  downPaymentPercent?: number;
  loanRate?: number;
  loanTermYears?: number;
  ongoingMonthlyCost?: number;
  saleProceeds?: number;
  purchaseYear: number;
};

/** Contribution profile list item from `trpc.contributionProfile.list`. Only
 *  the fields actually read by the selector UI are declared.
 */
export type ContribProfileListItem = {
  id: number;
  name: string;
  isDefault: boolean;
};
