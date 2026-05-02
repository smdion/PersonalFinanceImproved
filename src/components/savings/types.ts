import { formatDate } from "@/lib/utils/format";
import type { TargetMode } from "@/lib/config/enum-values";

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
  monthlyContribution: string;
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
