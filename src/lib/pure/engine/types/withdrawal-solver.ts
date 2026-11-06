/** What the withdrawal solver (`withdrawal-solver.ts`) returns. */

/** The figures every solver result carries. */
export interface SolverFigures {
  /** The taxable Social Security the accepted trial ROUTED with (routing's
   *  bracket caps read it). The real year must route with this same figure
   *  to reproduce the accepted trial's slots, then prices its own taxable
   *  share from them, exactly as the trial did. */
  taxableSS: number;
  /** Estimated tax cost */
  estTax: number;
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
   *  avoid it). Part of the solver's cost beside `estTax`. */
  estPenalty: number;
}

/** `met`: the accepted trial's after-tax proceeds reach the need. `capped`:
 *  they fall short (the pool, the router or the trial cap), by `shortfall`. */
export type TaxEstimationResult = SolverFigures &
  ({ status: "met" } | { status: "capped"; shortfall: number });
