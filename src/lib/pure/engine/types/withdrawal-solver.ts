/** What the withdrawal solver (`withdrawal-solver.ts`) returns. */

/** The figures every solver result carries. */
export interface SolverFigures {
  /** The taxable Social Security the accepted trial routed with (bracket caps
   *  read it). The real year routes with this same figure to reproduce the
   *  trial's slots, then prices its own taxable share from them. */
  taxableSS: number;
  /** Estimated tax cost */
  estimatedTax: number;
  /** Effective tax rate */
  effectiveTaxRate: number;
  /** Gross-up factor (1 / (1 - effectiveTaxRate)) */
  grossUpFactor: number;
  /** Grossed-up withdrawal need */
  grossedUpNeed: number;
  /** Target withdrawal (never above `totalBalance`) */
  targetWithdrawal: number;
  /** With `fixedGrossWithdrawal`: what it delivers after tax and penalty —
   *  the year's after-tax need, so every reader of that need (shortfall,
   *  RMD excess, post-RMD recompute) works unchanged. */
  derivedAfterTaxNeed?: number;
  /** Estimated early-withdrawal penalty: 0 without per-account tracking or
   *  when nothing was penalized (routing skips penalized money when told to
   *  avoid it). Part of the solver's cost beside `estimatedTax`. */
  estimatedPenalty: number;
}

/** Estimated before routing; not materiality (pair with `unmetNeedMaterial`). `capped`: over a cent
 *  short, as need less after-tax proceeds (gross-up), need less money delivered (gross-up off) or
 *  amount less money delivered (fixed), or the trial cap ran out short. `met` otherwise. */
export type TaxEstimationResult = SolverFigures &
  ({ status: "met" } | { status: "capped"; shortfall: number });
