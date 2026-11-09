/**
 * Which journal points a migrator sweep runs. Every point on every run
 * made the two replay suites the slowest files in the suite (a sweep at
 * every entry, times every later entry), so a run takes the first and last
 * points and a few seeded others; the seed is printed, so a failure reruns
 * with LEDGR_SWEEP_SEED=<seed>. LEDGR_FULL_MIGRATOR_SWEEP=1 runs every
 * point (the weekly migrator-sweep workflow).
 */
import { randomInt } from "node:crypto";

/** Points a sampled run takes besides the first and last. */
const SAMPLED = 4;

/** Mulberry32: the same seed picks the same points. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleJournalPoints<T>(
  points: readonly T[],
  sweep: string,
): T[] {
  if (
    process.env.LEDGR_FULL_MIGRATOR_SWEEP === "1" ||
    points.length <= SAMPLED + 2
  )
    return [...points];
  const seed = process.env.LEDGR_SWEEP_SEED
    ? Number(process.env.LEDGR_SWEEP_SEED)
    : randomInt(2 ** 31);
  console.info(
    `${sweep}: ${SAMPLED + 2} of ${points.length} journal points, seed ${seed} (LEDGR_SWEEP_SEED=${seed} reruns them; LEDGR_FULL_MIGRATOR_SWEEP=1 runs all)`,
  );
  const next = seeded(seed);
  const middle = points.slice(1, -1).map((p, i) => ({ p, i }));
  for (let i = middle.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [middle[i], middle[j]] = [middle[j]!, middle[i]!];
  }
  const picked = middle
    .slice(0, SAMPLED)
    .sort((a, b) => a.i - b.i)
    .map((m) => m.p);
  return [points[0]!, ...picked, points.at(-1)!];
}
