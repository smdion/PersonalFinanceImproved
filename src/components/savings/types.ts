import { formatDate } from "@/lib/utils/format";
import type { TargetMode } from "@/lib/config/enum-values";

/** Canonical savings-goal row shape — was independently redeclared (as
 *  narrower subsets) across ~4 files (M13, .scratch/docs/review-findings.md).
 *  Import this instead of re-declaring a local `RawGoal`. */
export interface RawGoal {
  id: number;
  name: string;
  monthlyContribution: string | null;
  allocationPercent?: string | null;
  isActive: boolean;
  isEmergencyFund: boolean;
  targetDate: string | null;
  targetAmount: string | null;
  targetMode: string;
  parentGoalId: number | null;
  priority: number;
  apiCategoryId?: string | null;
  apiCategoryName?: string | null;
  isApiSyncEnabled?: boolean | null;
  /** The linked category's real current-month `budgeted` amount, resolved
   *  server-side from the same month-scoped cache snapshot `current`
   *  comes from — `null` when not API-linked or no fresh sync data for
   *  this month. Feeds `projectGoalBalances`' month-0 math; see
   *  `ProjectionGoalInput.currentMonthBudgeted`'s own docblock. */
  currentMonthBudgeted?: number | null;
}

/** Canonical planned-transaction row shape — was independently redeclared
 *  across ~7 files (M13). One redeclaration (fund-details-tab.tsx) was
 *  missing isRecurring/recurrenceMonths/transferPairId, a real display gap
 *  now closed by importing this instead. */
export interface PlannedTransaction {
  id: number;
  goalId: number;
  transactionDate: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  recurrenceMonths: number | null;
  transferPairId?: string | null;
  source?: string;
  /** Occurrence months ("YYYY-MM") already settled for this row. */
  settledOccurrences?: string[];
}

export interface PlannedTxForm {
  goalId: number;
  transactionDate: string;
  amount: string;
  description: string;
  isRecurring: boolean;
  recurrenceMonths: string;
}

export const emptyTxForm = (goalId: number): PlannedTxForm => ({
  goalId,
  transactionDate: "",
  amount: "",
  description: "",
  isRecurring: false,
  recurrenceMonths: "",
});

export interface NewFundForm {
  name: string;
  targetAmount: string;
  targetMode: TargetMode;
  targetDate: string;
  parentGoalId?: number | null;
}

export type SavingsTab = "projections" | "funds" | "transactions";

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(d: Date): string {
  return formatDate(d, "short");
}

export interface MonthEvent {
  id: string;
  /** Source row + specific occurrence — needed to target a settle action. */
  plannedTxId: number;
  occurrenceMonth: string;
  amount: number;
  description: string;
}

export interface GoalProjection {
  name: string;
  goalId: number;
  current: number;
  target: number;
  targetMode: TargetMode;
  monthlyAllocation: number;
  monthlyAllocations: number[];
  balances: number[];
  monthEvents: (MonthEvent[] | null)[];
  hasOverride: boolean[];
}
