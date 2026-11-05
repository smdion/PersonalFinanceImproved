/**
 * Helpers for the answer-key suites (`tests/**\/answer-key-*.test.ts`).
 *
 * The answer key holds figures worked by hand from the published rules,
 * never read back from `src/`. Each case is titled `<area>/<id>` (e.g.
 * `tax/B2 [TAX-05]`, the bracketed part being its docs/CALCULATIONS.md
 * row). A second test of the same case adds a suffix to the id
 * (`ret/P9:engine`), so ids stay unique across the files;
 * `tests/lint/answer-key.test.ts` checks that and the naming rules below.
 *
 * - `cents`: function-level money, exact to the cent (±$0.005).
 * - `ledgerRow`: one engine-ledger row, ±$1 a row for rounding and
 *   convergence; balances carry the allowance forward a dollar a row.
 * - `xfail`: an expected failure until a later release fixes it. It writes
 *   the decided figure as `it.fails` and, when today's (wrong) figure is
 *   known, pins it beside it, so a broken fixture can't pass the `it.fails`
 *   by throwing. The fix commit deletes the pin and flips the case.
 * - `runOneYear`: one engine year from a plain `ProjectionInput`.
 */
import { expect, it } from "vitest";
import { calculateProjection } from "@/lib/calculators/engine";
import type {
  EngineYearProjection,
  ProjectionInput,
} from "@/lib/pure/engine/types";

/** Function-level money tolerance: half a cent. */
const CENT_TOLERANCE = 0.005;
/** Engine-ledger tolerance per row (UD-25, D12.12). */
const LEDGER_ROW_TOLERANCE = 1;

/** A figure, or named figures checked together. */
type Figures = number | Readonly<Record<string, number>>;

/** Assert `actual` is within `tolerance` of `expected`, naming the figure. */
function expectNear(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
): void {
  expect(
    Math.abs(actual - expected),
    `${label}: got ${actual}, expected ${expected} ±${tolerance}`,
  ).toBeLessThanOrEqual(tolerance + 1e-9);
}

function expectFigures(
  actual: Figures,
  expected: Figures,
  tolerance: number,
): void {
  if (typeof expected === "number") {
    expect(typeof actual, "a single figure").toBe("number");
    expectNear(actual as number, expected, tolerance, "figure");
    return;
  }
  expect(typeof actual, "named figures").toBe("object");
  const got = actual as Readonly<Record<string, number>>;
  for (const [key, want] of Object.entries(expected)) {
    expect(got[key], `${key} is missing`).toBeTypeOf("number");
    expectNear(got[key]!, want, tolerance, key);
  }
}

/**
 * Money to the cent: one figure, or every named figure in `expected` (keys
 * in `actual` that `expected` doesn't name are ignored).
 */
export function cents(
  actual: Figures,
  expected: Figures,
  tolerance = CENT_TOLERANCE,
): void {
  expectFigures(actual, expected, tolerance);
}

/**
 * One ledger row (row 0 is the first year). Flows are ±$1; each key in
 * `balanceKeys` is ±$1 for every row so far, since a dollar of rounding in
 * one year's flow carries into every later balance.
 */
export function ledgerRow(
  actual: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
  opts: { row: number; balanceKeys?: readonly string[] },
): void {
  const balances = new Set(opts.balanceKeys ?? []);
  for (const [key, want] of Object.entries(expected)) {
    expect(actual[key], `row ${opts.row}: ${key} is missing`).toBeTypeOf(
      "number",
    );
    const tolerance = balances.has(key)
      ? LEDGER_ROW_TOLERANCE * (opts.row + 1)
      : LEDGER_ROW_TOLERANCE;
    expectNear(actual[key]!, want, tolerance, `row ${opts.row}: ${key}`);
  }
}

/**
 * The release that fixes an expected failure, named first in its `todo`:
 * `v0.11 Tax "One returnDeductions()"`. Shared with the lint check.
 */
export const XFAIL_TODO_PATTERN = /^v0\.1[1-9](\.\d+)? \S/;

/** Ids are `<area>/<id>`, lower-case area, then the source's own id. */
export const ANSWER_KEY_ID_PATTERN = /^[a-z]+\/[A-Za-z0-9][^\s]*$/;

interface XfailCase<T extends Figures> {
  /** `<area>/<id>`, plus ` [ROW-ID]` for its CALCULATIONS.md row. */
  id: string;
  /** The release and TODO item (and decision id, where one set the value). */
  todo: string;
  run: () => T | Promise<T>;
  /** The decided figure: what the code should give once fixed. */
  expected: T;
  /** Today's (wrong) figure, from the key's "Today" column, when known. */
  today?: T;
  /** Defaults to a cent. */
  tolerance?: number;
}

/** Title of the `it.fails` an `xfail` writes. */
export function xfailTitle(id: string, todo: string): string {
  return `${id} — expected failure until ${todo}`;
}

/**
 * An expected failure: `it.fails` on the decided figure, plus a plain pin
 * of today's figure when the key gives one.
 */
export function xfail<T extends Figures>(c: XfailCase<T>): void {
  const idPart = c.id.split(" ")[0]!;
  if (!ANSWER_KEY_ID_PATTERN.test(idPart))
    throw new Error(`xfail id "${c.id}" isn't <area>/<id>`);
  if (!XFAIL_TODO_PATTERN.test(c.todo))
    throw new Error(
      `xfail ${c.id}: todo "${c.todo}" must start with the fixing release, e.g. v0.11 Tax "…"`,
    );
  const tolerance = c.tolerance ?? CENT_TOLERANCE;
  it.fails(xfailTitle(c.id, c.todo), async () => {
    expectFigures(await c.run(), c.expected, tolerance);
  });
  if (c.today !== undefined) {
    const today = c.today;
    it(`${c.id} — today's figure, wrong until ${c.todo}`, async () => {
      expectFigures(await c.run(), today, tolerance);
    });
  }
}

/** One engine year (`year`, or the first) of a projection. */
export function runOneYear(
  input: ProjectionInput,
  year?: number,
): EngineYearProjection {
  const years = calculateProjection(input).projectionByYear;
  const row =
    year === undefined ? years[0] : years.find((y) => y.year === year);
  if (!row) throw new Error(`the projection has no year ${year ?? "(first)"}`);
  return row;
}
