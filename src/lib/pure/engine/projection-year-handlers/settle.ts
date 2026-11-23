/** The year's settled points: where a flow's writes have all landed. */
import type { ProjectionLoopState } from "./types";

/** A flow's end, where every track (tax buckets, categories, account parts
 *  and their basis) has taken that flow's writes, in each year's order. */
export type SettledPoint =
  | "accumulation.contributions"
  | "accumulation.gapDraw"
  | "accumulation.growth"
  | "accumulation.goalDraws"
  | "accumulation.beforeReconcile"
  | "decumulation.qcd"
  | "decumulation.draws"
  | "decumulation.conversion"
  | "decumulation.portfolioContributions"
  | "decumulation.growth"
  | "decumulation.beforeReconcile";

/** Called once at each settled point of every year; it writes nothing. */
export function settle(_state: ProjectionLoopState, _point: SettledPoint) {}
