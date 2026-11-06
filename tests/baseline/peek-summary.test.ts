/**
 * The dashboard Retirement tile shows the same figures from
 * `projection.peekMonteCarloSummary` as it did from the full
 * `computeMonteCarloProjection` peek, for every baseline household: the
 * tile's own derivations (success rate and its tone, nest-egg median and
 * range at any target age) are computed from both recorded responses and
 * compared. Reads the recorded files only; never re-records them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HOUSEHOLDS } from "./households";
import { simulationDollars } from "@/lib/pure/simulation/dollars";
import { simulatedOrBaseline } from "@/lib/pure/retirement/nest-egg-display";
import { simulationRateTone } from "@/lib/config/simulation-tones";
import { formatCurrency, formatPercent } from "@/lib/utils/format";
import type { MonteCarloResult } from "@/lib/pure/simulation/monte-carlo.types";

type Band = {
  age: number;
  year: number;
  p25: number;
  p50: number;
  p75: number;
};
type Tile = { successRate: number | null; bands: readonly Band[] | null };

const read = (household: string, procedure: string): unknown =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, "__baseline__", household, `${procedure}.json`),
      "utf8",
    ),
  );

/** What the card read from the full peek (as it did before the summary). */
function fromFull(household: string): Tile {
  const full = read(household, "projection.computeMonteCarloProjection") as {
    result?: MonteCarloResult | null;
  };
  return full.result
    ? {
        successRate: full.result.successRate,
        bands: simulationDollars(full.result, "real").percentileBands,
      }
    : { successRate: null, bands: null };
}

/** What the card reads from the summary today. */
function fromSummary(household: string): Tile {
  const peek = read(household, "projection.peekMonteCarloSummary") as {
    result: { successRate: number; todayBands: Band[] } | null;
  };
  return peek.result
    ? { successRate: peek.result.successRate, bands: peek.result.todayBands }
    : { successRate: null, bands: null };
}

/** Every figure the tile renders from the peek, as the card formats it. */
function rendered(tile: Tile) {
  const baseline = 123_456;
  const ages = [...new Set([...(tile.bands ?? []).map((b) => b.age), 0, 200])];
  return {
    success:
      tile.successRate === null
        ? null
        : {
            text: formatPercent(tile.successRate, 0),
            tone: simulationRateTone(tile.successRate),
          },
    nestEgg: ages.map((targetAge) => {
      const display = simulatedOrBaseline({
        bands: tile.bands,
        baseline,
        targetAge,
        personFiltered: false,
      });
      return display.kind === "simulated"
        ? {
            targetAge,
            median: formatCurrency(display.median),
            low: formatCurrency(display.low),
            high: formatCurrency(display.high),
            raw: [display.median, display.low, display.high],
          }
        : { targetAge, baseline: formatCurrency(display.baseline) };
    }),
  };
}

describe.each(HOUSEHOLDS.map((h) => [h.key] as const))("%s", (key) => {
  it("the tile shows the same figures from the summary as from the full peek", () => {
    const full = fromFull(key);
    const summary = fromSummary(key);
    expect(summary.successRate).not.toBeNull();
    expect(rendered(summary)).toEqual(rendered(full));
  });
});
