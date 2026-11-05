/**
 * scripts/check-size-baseline.ts: a move keeps a file's counts under its new
 * path, and a split records its parts (function entries carried across, a
 * part over 400 allowed only within the old entry). Invented paths and
 * counts; nothing reads src/.
 */
import { describe, expect, it } from "vitest";
import {
  check,
  moved,
  recorded,
  type Baseline,
} from "../../scripts/check-size-baseline";

const OLD = "src/server/routers/garden.ts";
const NEW = "src/server/routers/garden/index.ts";
const PART_A = "src/server/routers/garden/beds.ts";
const PART_B = "src/server/routers/garden/harvest.ts";

const baseline = (): Baseline => ({
  files: { [OLD]: 900, "src/other.ts": 450 },
  functions: {
    [OLD]: {
      "gardenRouter.plant.mutation()": 300,
      "gardenRouter.harvest.query()": 200,
    },
  },
});

describe("--move", () => {
  it("keeps the file and function counts under the new key", () => {
    const measured: Baseline = {
      files: { [NEW]: 880, "src/other.ts": 450 },
      functions: { [NEW]: { "gardenRouter.plant.mutation()": 290 } },
    };
    const result = moved(baseline(), measured, [OLD, NEW]);
    expect(result.problems).toEqual([]);
    expect(result.baseline.files).toEqual({
      [NEW]: 900,
      "src/other.ts": 450,
    });
    expect(result.baseline.functions).toEqual({
      [NEW]: baseline().functions[OLD],
    });
    expect(result.baseline.files[OLD]).toBeUndefined();
    // The moved file is checked against its old counts.
    expect(check(result.baseline, measured)).toHaveLength(3);
  });

  it("refuses a file not yet moved, a missing target and odd arguments", () => {
    const measured: Baseline = { files: { [OLD]: 900 }, functions: {} };
    expect(moved(baseline(), measured, [OLD, NEW]).problems).toEqual([
      `${OLD}: still exists; move the file first`,
    ]);
    expect(
      moved(baseline(), { files: {}, functions: {} }, [OLD, NEW]).problems,
    ).toEqual([`${NEW}: not a measured src/ file`]);
    expect(moved(baseline(), measured, [OLD]).problems).toEqual([
      "--move takes <old> <new> pairs",
    ]);
  });

  it("moves an unrecorded file without adding an entry", () => {
    const measured: Baseline = {
      files: { "src/b.ts": 120 },
      functions: {},
    };
    const result = moved(baseline(), measured, ["src/a.ts", "src/b.ts"]);
    expect(result.problems).toEqual([]);
    expect(result.baseline).toEqual(baseline());
  });
});

describe("--record", () => {
  const split = (a: number, b: number, fns: Baseline["functions"] = {}) => ({
    files: { [PART_A]: a, [PART_B]: b, "src/other.ts": 450 },
    functions: fns,
  });

  it("refuses a part over 400 without --from", () => {
    expect(
      recorded(baseline(), split(420, 300), [PART_A, PART_B]).problems,
    ).toEqual([
      `${PART_A}: 420 lines, limit 400 — split it; never raise the baseline`,
    ]);
  });

  it("records a part over 400 at its size when the parts fit the old entry", () => {
    const measured = split(560, 330, {
      [PART_A]: { "bedsRouter.plant.mutation()": 300 },
      [PART_B]: { "harvestRouter.harvest.query()": 190 },
    });
    const result = recorded(baseline(), measured, [PART_A, PART_B], OLD);
    expect(result.problems).toEqual([]);
    expect(result.baseline.files[PART_A]).toBe(560);
    expect(result.baseline.files[PART_B]).toBe(330);
    // Function entries carried across under the part's router name.
    expect(result.baseline.functions[PART_A]).toEqual({
      "bedsRouter.plant.mutation()": 300,
    });
    expect(result.baseline.functions[PART_B]).toEqual({
      "harvestRouter.harvest.query()": 190,
    });
  });

  it("refuses parts that together exceed the old entry", () => {
    expect(
      recorded(baseline(), split(560, 341), [PART_A, PART_B], OLD).problems,
    ).toEqual([
      `${OLD}: the parts and what is left total 901 lines, entry 900 — split it; never raise the baseline`,
    ]);
  });

  it("counts what is left of the old file", () => {
    const measured = {
      ...split(500, 300),
      files: { ...split(500, 300).files, [OLD]: 120 },
    };
    expect(
      recorded(baseline(), measured, [PART_A, PART_B], OLD).problems,
    ).toEqual([
      `${OLD}: the parts and what is left total 920 lines, entry 900 — split it; never raise the baseline`,
    ]);
  });

  it("refuses a carried function that grew, and a long one with no entry", () => {
    const measured = split(300, 300, {
      [PART_A]: { "bedsRouter.plant.mutation()": 301 },
      [PART_B]: { "harvestRouter.weed.query()": 160 },
    });
    expect(
      recorded(baseline(), measured, [PART_A, PART_B], OLD).problems,
    ).toEqual([
      `${PART_A} bedsRouter.plant.mutation()(): 301 lines, ${OLD} gardenRouter.plant.mutation()() 300 — split it; never raise the baseline`,
      `${PART_B} harvestRouter.weed.query()(): 160 lines, no entry in ${OLD} — split it; never raise the baseline`,
    ]);
  });

  it("refuses --from a file with no entry", () => {
    expect(
      recorded(baseline(), split(100, 100), [PART_A], "src/none.ts").problems,
    ).toEqual(["src/none.ts: no entry to split from"]);
  });
});
