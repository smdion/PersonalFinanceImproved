// What a gap year draws from the accounts: one person retired, the other working.

import type { DecumulationSlot } from "./routing";

export type GapYearDraw = {
  /** Spending the year's pay doesn't cover, after tax. */
  need: number;
  /** What came out of the accounts: the need plus the tax on it. */
  withdrawal: number;
  /** Tax and any penalty on the draw (not on the pay). */
  taxCost: number;
  /** The need no reachable money could fund. */
  unmetNeed: number;
  /** Spending given up by choice: the household draws nothing these years. */
  spendingCut: number;
  /** What the year's figures were, for the row's explanation. */
  pay: number;
  ssIncome: number;
  contributions: number;
  taxOnIncome: number;
  spending: number;
  slots: DecumulationSlot[];
  warnings: string[];
};
