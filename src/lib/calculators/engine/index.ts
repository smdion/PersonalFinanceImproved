/**
 * Engine barrel file — re-exports the public API from submodules.
 *
 * All consumer imports (`from './engine'` or `from '@/lib/calculators/engine'`)
 * resolve here. As modules are extracted, this file re-exports from the
 * individual submodules instead of from `./projection`.
 *
 * Modules (extracted):
 *   projection.ts          — orchestrator (shrinks as modules are extracted)
 *   override-resolution.ts — sticky-forward config resolution
 *   contribution-routing.ts — accumulation allocation + IRS limits
 *   tax-estimation.ts      — SS torpedo convergence + gross-up
 *   withdrawal-routing.ts  — bracket-filling / waterfall / percentage
 *   balance-utils.ts       — cloning, conversion helpers
 *
 *   rmd-enforcement.ts    — RMD factor lookup + shortfall distribution
 *   post-withdrawal-optimizer.ts — Roth conversions + IRMAA + ACA
 *   guyton-klinger.ts      — dynamic spending guardrails
 *   growth-application.ts  — return rate on all balance structures
 *   individual-account-tracking.ts — per-account bookkeeping (contributions, withdrawals, growth)
 *   balance-deduction.ts   — withdrawal deduction, clamping, depletion, dust cleanup
 */

export { calculateProjection } from "./projection";

export {
  estimateEffectiveTaxRate,
  incomeCapForMarginalRate,
  computeTaxableSS,
} from "./tax-estimation";

export type { WithholdingBracket } from "./tax-estimation";
