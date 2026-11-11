/** The run's price level by calendar year, 1 in the as-of year: the path
 *  calculateProjection compounds with (runInflationPath, validated rates),
 *  so today's dollars divide by the engine's own index. */
import { runInflationPath } from "./inflation-path";
import { validateEngineInputs } from "./input-validation";
import type { ProjectionInput } from "./types/projection-result";

export function projectionPriceLevel(
  input: ProjectionInput,
): (year: number) => number {
  const path = runInflationPath(input, validateEngineInputs(input, []));
  const baseYear = input.asOfDate.getFullYear();
  return (year) => path.growth(year - baseYear);
}
