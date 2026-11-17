/** What the retirement plan doesn't include, one line each, listed under the
 *  projection on the Retirement page. A change that models one deletes its
 *  line; each line's comment names the docs row that tracks it. */
export const PLAN_EXCLUSIONS: readonly string[] = [
  // TAX-01: federal tax only.
  "State and local income tax: every tax figure is federal.",
  // TAX-02 Gaps: no other income; the yearly brokerage yield isn't drawn.
  "Pensions, annuities, and the dividends and interest a taxable brokerage pays each year: none of it is counted as income.",
  // CALCULATIONS § Rules Ledgr doesn't model: survivor step-up at a first death.
  "A first death: both spouses are planned to the end, with no survivor benefit, no single filing status and no lower spending.",
  // TAX-03; `lib/pure/tax/tax.ts`.
  "Itemized deductions: every year takes the standard deduction.",
  // CALCULATIONS § Rules Ledgr doesn't model: Medicare Part B and D base premiums.
  "Standard Medicare Part B and D premiums: only the income-based surcharge is counted, so put the premiums in your Retirement budget.",
  // TAX-01 Gaps: no MFS.
  "Married filing separately, which isn't a supported filing status.",
  // RULES Known Gaps: RMDs before withdrawals start.
  "Required minimum distributions before withdrawals start: a year with no withdrawals takes none.",
  // TAX-01 Gaps: no credits.
  "Tax credits, such as the child tax credit: none is subtracted, so the tax shown can be more than you'd owe.",
  // LIM-06: the cap pass counts every job; pay follows one.
  "Two jobs at once for one person: the contribution limits count every job, but pay follows one job at a time.",
  // TAX-03, TAX-21: the §63(f) blindness add-on.
  "The extra standard deduction for blindness.",
  // LIM-06, LIM-18 Gaps.
  "Payroll stopping at the 401(k) limit, and an employer's match true-up: a year's contributions are spread over all its paychecks.",
  // LIM-08 Gaps: coverage after a job ends.
  "HSA coverage after a job ends (COBRA or a spouse's plan): the HSA limit ends with the job's HSA.",
  // LIM-08 Gaps: the per-spouse family ceiling.
  "Each spouse's share of a family HSA limit when one spouse's HSA job ends during the year.",
  // ENG-20 Gaps: average cost.
  "Brokerage cost basis by lot: a sale's gain is its share of the account's whole gain (average cost), and losses aren't realized.",
];
