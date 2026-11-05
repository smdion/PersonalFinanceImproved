/**
 * The § 11.6 30-year rolling grid replayed through the production engine
 * (simulation spec Appendix A, SP-95, SP-116), for
 * `answer-key-simulation-reference.test.ts`: the answer key (K15) and the
 * behavior baseline (`behavior-baseline-replay-grid.ts`).
 *
 * History goes in as one return per age (that calendar year's blended
 * return) and that year's CPI change as an inflation shock, plan inflation
 * 0. Inputs: the invented reference retiree (`tests/fixtures/
 * answer-key-simulation.ts`) and the market history in
 * `cfiresim-export.csv` (public data, no household in it).
 */
import * as fs from "fs";
import * as path from "path";
import { retiree } from "../fixtures/answer-key-simulation";
import { calculateProjection } from "@/lib/pure/engine";
import { assessPlan } from "@/lib/pure/retirement/plan-outcome";

/** Stock shares of the grid's rows, as the spec's table keys them. */
export const REPLAY_STOCK_SHARES = ["1", "0.75", "0.6", "0.5", "0.25", "0"];
/** Withdrawal rates of the grid's columns. */
export const REPLAY_RATES = [0.03, 0.035, 0.04, 0.045, 0.05, 0.06, 0.07];
const FIRST_START = 1871;
const LAST_START = 1995;
const YEARS = 30;
const START = 1_000_000;

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const h = (s.length - 1) / 2;
  const lo = Math.floor(h);
  return s[lo]! + (h - lo) * (s[Math.ceil(h)]! - s[lo]!);
};

/** The export's year-by-year series (spec Appendix A): stock growth `g`
 *  and dividends `d` as shares of the year's equity start, bond return
 *  `b` (`braw`, the raw yield a cycle's last year earns, only where no
 *  other cycle covers the year) and CPI change `pi`, each the median over
 *  the cycles that contain the year (they agree to rounding). */
function exportSeries() {
  const text = fs.readFileSync(
    path.join(__dirname, "cfiresim-export.csv"),
    "utf8",
  );
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head!.split(",");
  const at = (k: string) => cols.indexOf(k);
  const rows = lines
    .map((l) => l.split(","))
    .filter((c) => /^\d+$/.test((c[at("cycle_starting_year")] ?? "").trim()));
  const num = (c: string[], k: string) => Number(c[at(k)] || 0);
  const by = new Map<
    number,
    Record<"g" | "d" | "b" | "braw" | "pi", number[]>
  >();
  const slot = (y: number) => {
    if (!by.has(y)) by.set(y, { g: [], d: [], b: [], braw: [], pi: [] });
    return by.get(y)!;
  };
  const cycles = new Map<number, string[][]>();
  for (const c of rows) {
    const y = num(c, "year");
    const s = slot(y);
    s.g.push(num(c, "equities_growth") / num(c, "equities_start"));
    s.d.push(num(c, "dividends") / num(c, "equities_start"));
    (num(c, "segment_number") === 56 ? s.braw : s.b).push(
      num(c, "bonds_growth") / num(c, "bonds_start"),
    );
    const start = num(c, "cycle_starting_year");
    cycles.set(start, [...(cycles.get(start) ?? []), c]);
  }
  for (const cyc of cycles.values())
    for (let i = 1; i < cyc.length; i++)
      slot(num(cyc[i]!, "year")).pi.push(
        num(cyc[i]!, "cumulative_cpi") / num(cyc[i - 1]!, "cumulative_cpi"),
      );
  const g = new Map<number, number>();
  const d = new Map<number, number>();
  const b = new Map<number, number>();
  const pi = new Map<number, number>();
  for (const [y, s] of by) {
    g.set(y, median(s.g));
    d.set(y, median(s.d));
    b.set(y, median(s.b.length ? s.b : s.braw));
    if (s.pi.length) pi.set(y, median(s.pi) - 1);
  }
  return { g, d, b, pi };
}

/** One grid cell: a stock share and a withdrawal rate over every start. */
export interface ReplayCell {
  /** Start years whose every withdrawal was paid, out of 125. */
  successes: number;
  /** Failing starts with the first unpaid year (1 = the start year). */
  failures: [start: number, firstUnpaidYear: number][];
  /** Median last-row retirement balance over the 125 starts, nominal. */
  medianEndBalance: number;
}

/** The 42 cells, keyed by stock share then rate (`"0.6|0.04"`). */
export function replayGrid(): Record<string, ReplayCell> {
  const { g, d, b, pi } = exportSeries();
  const grid: Record<string, ReplayCell> = {};
  for (const share of REPLAY_STOCK_SHARES) {
    const w = Number(share);
    for (const rate of REPLAY_RATES) {
      const cell: ReplayCell = {
        successes: 0,
        failures: [],
        medianEndBalance: 0,
      };
      const ends: number[] = [];
      for (let s0 = FIRST_START; s0 <= LAST_START; s0++) {
        const years = Array.from({ length: YEARS }, (_, j) => s0 + j);
        const result = calculateProjection(
          retiree({
            start: START,
            spend: rate * START,
            years: YEARS,
            inflation: 0,
            returnPath: years.map(
              (y) => w * (g.get(y)! + d.get(y)!) + (1 - w) * b.get(y)!,
            ),
            // Year 1's withdrawal is unindexed; year j's carries the CPI
            // change into calendar year s0 + j.
            shocks: years.map((y, j) => (j === 0 ? 0 : pi.get(y)!)),
          }),
        );
        const outcome = assessPlan(result);
        if (outcome.succeeded) cell.successes++;
        else cell.failures.push([s0, outcome.failureYear - 2026 + 1]);
        ends.push(result.projectionByYear.at(-1)!.retirementBalance);
      }
      cell.medianEndBalance = median(ends);
      grid[`${share}|${rate}`] = cell;
    }
  }
  return grid;
}
