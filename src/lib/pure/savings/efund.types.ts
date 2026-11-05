/** calculateEFund's input and result: months of essential spending the
 *  emergency fund covers, with and without its self-loans repaid. */

export type EFundInput = {
  emergencyFundBalance: number;
  outstandingSelfLoans: number; // money owed back to the e-fund (subtracted from true balance, added in "with repay")
  essentialMonthlyExpenses: number;
  targetMonths: number; // user-configurable target (e.g. 4 months)
  asOfDate: Date;
};

export type EFundResult = {
  rawBalance: number; // current balance (before subtracting loans)
  trueBalance: number; // balance minus outstanding self-loans
  outstandingSelfLoans: number;
  balanceWithRepay: number; // rawBalance + selfLoans (what you'd have once loans are repaid)
  monthsCovered: number | null; // rawBalance / essentialExpenses ("Current Months")
  monthsCoveredWithRepay: number | null; // balanceWithRepay / essentialExpenses ("Repaid Months")
  targetMonths: number;
  targetAmount: number; // targetMonths × essentialMonthlyExpenses
  neededAfterRepay: number; // targetAmount - balanceWithRepay (negative = ahead of target)
  progress: number; // monthsCoveredWithRepay / targetMonths
  warnings: string[];
};
