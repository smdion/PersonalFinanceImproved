/**
 * Plain-language glossary for financial terms used across the app.
 * Data-driven: components import entries by key — no inline jargon definitions.
 */

export type GlossaryEntry = {
  /** Display label as used in the UI */
  label: string;
  /** Plain-language alternative (short, for subtitles) */
  plain: string;
  /** Beginner-friendly explanation (1–2 sentences) */
  description: string;
  /** Optional link to an in-app methodology or explanation page */
  learnMoreHref?: string;
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  brokerage: {
    label: "Brokerage",
    plain: "Taxable Investments",
    description:
      "A regular investment account with no special tax advantages. You pay taxes on gains when you sell.",
  },
  netWorth: {
    label: "Net Worth",
    plain: "What You Own Minus What You Owe",
    description:
      "The total value of your assets (investments, home, cash) minus your debts (mortgage, loans).",
  },
  retirement: {
    label: "Retirement",
    plain: "Long-Term Savings",
    description:
      "Tax-advantaged accounts like 401k, IRA, and HSA designed for retirement savings. Early withdrawals may incur penalties.",
  },
  accumulation: {
    label: "Accumulation",
    plain: "Saving & Growing Phase",
    description:
      "The years when you are working, contributing to accounts, and growing your portfolio before retirement.",
    learnMoreHref: "/retirement/accumulation-methodology",
  },
  decumulation: {
    label: "Decumulation",
    plain: "Spending Phase",
    description:
      "The years in retirement when you draw down your portfolio to cover living expenses.",
    learnMoreHref: "/retirement/decumulation-methodology",
  },
  safeWithdrawalRate: {
    label: "Safe Withdrawal Rate",
    plain: "How Much You Can Spend Per Year",
    description:
      'The percentage of your portfolio you can withdraw annually in retirement without running out of money. The classic "4% rule" is a common starting point.',
    learnMoreHref: "/retirement/methodology",
  },
  guytonKlinger: {
    label: "Guyton-Klinger",
    plain: "Flexible Spending Guardrails",
    description:
      "A retirement spending strategy that adjusts your withdrawals up or down based on portfolio performance, helping your money last longer.",
    learnMoreHref: "/retirement/decumulation-methodology",
  },
  monteCarlo: {
    label: "Monte Carlo Simulation",
    plain: "Probability Testing",
    description:
      "Runs thousands of possible market scenarios to estimate the probability that your retirement plan will succeed.",
    learnMoreHref: "/retirement/methodology",
  },
  costBasis: {
    label: "Cost Basis",
    plain: "What You Originally Paid",
    description:
      "The original price you paid for an investment. When you sell for more than your cost basis, you owe taxes on the difference (the gain).",
  },
  irmaa: {
    label: "IRMAA",
    plain: "Medicare Surcharge",
    description:
      "Income-Related Monthly Adjustment Amount — an extra Medicare premium charged to higher-income retirees. Triggered by exceeding specific income thresholds.",
  },
  rmd: {
    label: "RMD",
    plain: "Required Withdrawals",
    description:
      "Required Minimum Distributions — the IRS requires you to withdraw (and pay taxes on) a minimum amount from traditional retirement accounts starting at age 73.",
  },
  fireNumber: {
    label: "FIRE Number",
    plain: "Financial Independence Target",
    description:
      "The portfolio balance at which your investments can cover your annual expenses indefinitely. Typically calculated as annual expenses divided by your withdrawal rate.",
  },
  rothConversion: {
    label: "Roth Conversion",
    plain: "Tax Bucket Transfer",
    description:
      "Moving money from a traditional (pre-tax) retirement account to a Roth (tax-free) account. You pay taxes now but withdrawals in retirement are tax-free.",
  },
  savingsRate: {
    label: "Savings Rate",
    plain: "Percentage of Income Saved",
    description:
      "The portion of your take-home pay that goes into savings and investments rather than spending. A 25% savings rate is a common target.",
  },
  wealthMultiplier: {
    label: "Wealth Multiplier",
    plain: "Net Worth vs. Salary",
    description:
      "Your net worth expressed as a multiple of your annual salary. A benchmark for whether your savings are on track for your age.",
  },
};

/** Look up a glossary entry by key. Returns undefined if not found. */
export function getGlossaryEntry(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key];
}
