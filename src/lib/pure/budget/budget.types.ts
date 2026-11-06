/** calculateBudget's input (budget items with one amount per column) and
 *  result (totals by category, essential and discretionary). */

type BudgetItemInput = {
  category: string;
  label: string;
  amounts: number[];
  isEssential: boolean;
};

export type BudgetInput = {
  items: BudgetItemInput[];
  columnLabels: string[];
  selectedColumn: number; // index into columnLabels/amounts (0=Standard, 1=Tight, 2=Emergency)
  asOfDate: Date;
};

export type BudgetResult = {
  totalMonthly: number;
  essentialTotal: number;
  discretionaryTotal: number;
  categories: {
    name: string;
    total: number;
    items: { label: string; amount: number; isEssential: boolean }[];
  }[];
  warnings: string[];
};
