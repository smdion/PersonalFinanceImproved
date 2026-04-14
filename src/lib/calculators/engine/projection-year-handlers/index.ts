/**
 * projection-year-handlers — barrel re-exports for the projection engine's
 * per-year handler functions. Split out from the old 1,983-line single-file
 * in the v0.5.2 refactor. The public surface is unchanged — consumers import
 * from `./projection-year-handlers` and get the same functions + types.
 *
 * See `engine-snapshot.test.ts` for the parity guard that ran before and
 * after the split to confirm byte-identical engine output.
 */
export type {
  BrokerageGoal,
  ProjectionLoopState,
  ProjectionContext,
  PreYearSetup,
} from "./types";
export { buildProjectionContext } from "./context";
export { buildProjectionState } from "./state";
export { runPreYearSetup } from "./pre-year-setup";
export { runAccumulationYear } from "./accumulation-year";
export { runDecumulationYear } from "./decumulation-year";
