/**
 * The range of one year's return the Simulation expects at an age: the
 * middle 90% of its own yearly draws (same asset classes, correlations,
 * glide path and limits), so a real year can be read against what the plan
 * allows for. Seeded: the same plan always gives the same range.
 */
import {
  buildCorrelationMatrix,
  choleskyDecomposition,
  createPRNG,
  sampleBlendedReturn,
  type GlidePathEntry,
} from "./random";

/** Enough that the range's edges settle to a tenth of a point. */
const DRAWS = 5_000;
const SEED = 42;
const LOW_SHARE = 0.05;
const HIGH_SHARE = 0.95;

export type YearReturnRange = { age: number; low: number; high: number };

export function yearReturnRanges(args: {
  ages: readonly number[];
  assetClasses: Parameters<typeof sampleBlendedReturn>[1];
  correlations: Parameters<typeof buildCorrelationMatrix>[1];
  glidePath: GlidePathEntry[];
  clampMin: number;
  clampMax: number;
}): YearReturnRange[] {
  const { assetClasses, correlations, glidePath, clampMin, clampMax } = args;
  if (assetClasses.length === 0 || glidePath.length === 0) return [];
  const choleskyL = choleskyDecomposition(
    buildCorrelationMatrix(assetClasses, correlations),
  );
  return args.ages.map((age) => {
    const rng = createPRNG(SEED + age);
    const draws = Array.from({ length: DRAWS }, () =>
      Math.min(
        clampMax,
        Math.max(
          clampMin,
          sampleBlendedReturn(rng, assetClasses, choleskyL, glidePath, age),
        ),
      ),
    ).sort((a, b) => a - b);
    return {
      age,
      low: draws[Math.floor(DRAWS * LOW_SHARE)]!,
      high: draws[Math.floor(DRAWS * HIGH_SHARE)]!,
    };
  });
}
