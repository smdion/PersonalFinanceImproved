/** A fixed-target fund that has reached its target. */
export function isGoalMet(g: {
  targetMode: string;
  target: number;
  current: number;
}): boolean {
  return g.targetMode === "fixed" && g.target > 0 && g.current >= g.target;
}
