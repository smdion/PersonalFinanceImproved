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

/** Year-by-year engine projection row returned by `computeRelocationFiProjection`.
 *  Fields mirror `RelocationYearProjection` so the table can fall back to the
 *  old calculator rows when the engine result is unavailable.
 */
export type EngineProjectionRow = {
  year: number;
  age: number;
  currentContribution: number;
  currentBalance: number;
  relocationContribution: number;
  relocationBalance: number;
  /** relocationBalance - currentBalance (negative = behind). */
  delta: number;
  /** Annual projected expenses for the relocation scenario. Table displays /12 as monthly. */
  relocationExpenses: number;
  /** Whether a YearAdjustment override applies this year. */
  hasAdjustment: boolean;
  /** Net one-time portfolio impact from large purchases this year (negative = loss). */
  largePurchaseImpact: number;
};

/** Single row in the blended projection (current path → relocation path at moveYear). */
export type BlendedProjectionRow = {
  year: number;
  age: number;
  /** Portfolio balance at end of year (single blended-path value). */
  balance: number;
  contribution: number;
  /** Annual projected expenses. */
  expenses: number;
  phase: "current" | "relocation";
  hasAdjustment: boolean;
  largePurchaseImpact: number;
};

/** Engine-backed projection result from `computeRelocationFiProjection`.
 *  Shared by metrics-and-banner and projection-table.
 *  undefined = still loading; null = error or no retirement settings.
 */
export type RelocationEngineResult = {
  currentBalanceAtRetirement: number;
  relocationBalanceAtRetirement: number;
  /** Relocation annual expenses ÷ withdrawal rate (no SS adjustment). */
  relocationFiTarget: number;
  isViableNow: boolean;
  earliestRelocateAge: number | null;
  earliestRelocateYear: number | null;
  recommendedPortfolioToRelocate: number;
  /** Year-by-year accumulation rows from the engine — used by the two-column comparison table. */
  projectionRows: EngineProjectionRow[];
  /** Blended projection rows (current path → relocation path at moveYear). null when moveYear is not set. */
  blendedRows: BlendedProjectionRow[] | null;
  /** Portfolio balance at retirement age on the blended path. null when moveYear is not set. */
  blendedBalanceAtRetirement: number | null;
  /** Annual inflation rate from settings — used for real-dollar deflation. */
  inflationRate: number;
  /** Calendar year of the projection start — deflation base year. */
  baseYear: number;
};
