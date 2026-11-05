/** calculateSavings' input (goals and the monthly savings pool) and
 *  result (allocation and progress per goal). */

export type SavingsGoalInput = {
  id: number;
  name: string;
  currentBalance: number;
  targetBalance: number;
  allocationPercent: number; // share of the monthly savings pool
  isEmergencyFund: boolean;
  isActive: boolean;
};

export type SavingsInput = {
  goals: SavingsGoalInput[];
  monthlySavingsPool: number; // from budget — total available for savings
  essentialMonthlyExpenses: number;
  asOfDate: Date;
};

export type SavingsResult = {
  efundMonthsCovered: number | null;
  totalSaved: number;
  goals: {
    goalId: number;
    name: string;
    current: number;
    target: number;
    monthlyAllocation: number;
    progress: number;
    monthsToTarget: number | null;
  }[];
  warnings: string[];
};
