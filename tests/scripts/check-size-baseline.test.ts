/**
 * scripts/check-size-baseline.ts: a move keeps a file's counts under its new
 * path, and a split records its parts (function entries carried across, a
 * part over 400 allowed only within the old entry). Invented paths and
 * counts; nothing reads src/.
 */
import { describe, expect, it } from "vitest";
import {
  bodyCarry,
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

describe("--record --from: a procedure body moved whole into a service (owner Q14)", () => {
  const ROUTER = "src/server/routers/garden.ts";
  const SERVICE = "src/server/services/garden/summary.ts";
  const router = (procedure: string[]) =>
    [
      'import { createTRPCRouter, protectedProcedure } from "../trpc";',
      'import { computeGardenSummary } from "@/server/services/garden/summary";',
      "",
      "export const gardenRouter = createTRPCRouter({",
      ...procedure,
      "});",
    ].join("\n");
  const passThrough = [
    "  summary: protectedProcedure.query(({ ctx, input }) =>",
    "    computeGardenSummary(ctx, input),",
    "  ),",
  ];
  const service = [
    'import type { Ctx, Input } from "@/server/trpc";',
    'import { load } from "@/server/data/garden";',
    "",
    "export async function computeGardenSummary(",
    "  ctx: Ctx,",
    "  input: Input,",
    ") {",
    "  return load(ctx, input);",
    "}",
  ].join("\n");
  const was = [
    'import { createTRPCRouter, protectedProcedure } from "../trpc";',
    'import { load } from "@/server/data/garden";',
    "",
    "export const gardenRouter = createTRPCRouter({",
    "  summary: protectedProcedure.query(async ({ ctx, input }) => {",
    "    return load(ctx, input);",
    "  }),",
    "});",
  ].join("\n");
  const tree = (files: Record<string, string>) => (f: string) => files[f];
  const carry = (now = router(passThrough)) =>
    bodyCarry(
      ROUTER,
      [SERVICE],
      tree({ [ROUTER]: now, [SERVICE]: service }),
      tree({ [ROUTER]: was }),
    );
  const old: Baseline = {
    files: { [ROUTER]: 820 },
    functions: {
      [ROUTER]: {
        "gardenRouter.summary.query()": 700,
        "gardenRouter.summary.query().beds.map()": 300,
      },
    },
  };
  const measured = (fns: Record<string, number>, service = 812) => ({
    files: { [SERVICE]: service, [ROUTER]: 9 },
    functions: { [SERVICE]: fns },
  });

  it("names the router entry each new function takes, and what its signature adds", () => {
    // Signature 4 lines and a brace, over the arrow's head and `})`: +3.
    // The total: the router's imports the same, +2 service imports,
    // signature, brace and call (6), and none the service held before.
    expect(carry()).toEqual({
      renames: { computeGardenSummary: "gardenRouter.summary.query()" },
      wrapper: { computeGardenSummary: 3 },
      total: 2 + 6,
    });
    // A router that does more than call is no pass-through: only the two
    // service imports (owner Q13).
    expect(
      carry(
        router([
          "  summary: protectedProcedure.query(({ ctx, input }) =>",
          "    computeGardenSummary(ctx, input).then(log),",
          "  ),",
        ]),
      ),
    ).toEqual({ renames: {}, wrapper: {}, total: 2 });
  });

  it("records the moved function under its new name at its size, and the ones inside it", () => {
    const result = recorded(
      old,
      measured({
        computeGardenSummary: 703,
        "computeGardenSummary.beds.map()": 298,
      }),
      [SERVICE],
      ROUTER,
      carry(),
    );
    expect(result.problems).toEqual([]);
    expect(result.baseline.files[SERVICE]).toBe(812);
    expect(result.baseline.functions[SERVICE]).toEqual({
      computeGardenSummary: 703,
      "computeGardenSummary.beds.map()": 298,
    });
  });

  it("refuses a moved function past its signature, an inner one that grew, and a total past the allowance", () => {
    expect(
      recorded(
        old,
        measured(
          {
            computeGardenSummary: 704,
            "computeGardenSummary.beds.map()": 301,
          },
          822,
        ),
        [SERVICE],
        ROUTER,
        carry(),
      ).problems,
    ).toEqual([
      `${SERVICE} computeGardenSummary(): 704 lines, ${ROUTER} gardenRouter.summary.query()() 700 and +3 for its signature — split it; never raise the baseline`,
      `${SERVICE} computeGardenSummary.beds.map()(): 301 lines, ${ROUTER} gardenRouter.summary.query().beds.map()() 300 — split it; never raise the baseline`,
      `${ROUTER}: the parts and what is left total 831 lines, entry 820 and +8 for the moved bodies — split it; never raise the baseline`,
    ]);
    // Without the carry the renamed function has no entry, and no allowance.
    expect(
      recorded(old, measured({ computeGardenSummary: 700 }), [SERVICE], ROUTER)
        .problems,
    ).toEqual([
      `${SERVICE} computeGardenSummary(): 700 lines, no entry in ${ROUTER} — split it; never raise the baseline`,
      `${ROUTER}: the parts and what is left total 821 lines, entry 820 — split it; never raise the baseline`,
    ]);
  });
});

describe("--record --from: stages cut from a long function (owner v0.10.3 Q1)", () => {
  const YEAR = "src/lib/pure/engine/year.ts";
  const STAGES = "src/lib/pure/engine/stages/year-stages.ts";
  const was = [
    'import { load } from "./lib";',
    "",
    "export function runYear(a: number) {",
    "  const v0 = load(a, 0);",
    "  const v1 = load(a, 1);",
    "  load(a, 2);",
    "  return v0 + v1;",
    "}",
  ].join("\n");
  const now = [
    'import { load } from "./lib";',
    'import { vStage, wStage } from "./stages/year-stages";',
    "",
    "export function runYear(a: number) {",
    "  const { v0 } = vStage(a);",
    "  const v1 = load(a, 1);",
    "  wStage(a);",
    "  return v0 + v1;",
    "}",
  ].join("\n");
  const stages = [
    'import { load } from "../lib";',
    "",
    "export function vStage(a: number) {",
    "  const v0 = load(a, 0);",
    "",
    "  return { v0 };",
    "}",
    "",
    "export function wStage(a: number) {",
    "  load(a, 2);",
    "}",
  ].join("\n");
  const tree = (files: Record<string, string>) => (f: string) => files[f];
  const carry = () =>
    bodyCarry(
      YEAR,
      [STAGES],
      tree({ [YEAR]: now, [STAGES]: stages }),
      tree({ [YEAR]: was }),
    );
  const old: Baseline = {
    files: { [YEAR]: 900 },
    functions: { [YEAR]: { runYear: 800, "runYear.map()": 200 } },
  };
  const measured = (fns: Record<string, number>, part = 450) => ({
    files: { [STAGES]: part, [YEAR]: 452 },
    functions: { [STAGES]: fns },
  });

  it("names the function each stage was cut from, and what its wrapper and call add", () => {
    // vStage: signature, blank, return and brace (4), its call (1); wStage:
    // signature and brace (2), its call (1); a second import in each file.
    expect(carry()).toEqual({
      renames: {},
      wrapper: {},
      stages: { vStage: "runYear", wStage: "runYear" },
      total: 4 + 1 + 2 + 1 + 2,
    });
  });

  it("records stages that share their function's entry, and the ones inside them", () => {
    const result = recorded(
      old,
      measured({ vStage: 500, wStage: 290, "vStage.map()": 200 }),
      [STAGES],
      YEAR,
      carry(),
    );
    expect(result.problems).toEqual([]);
    expect(result.baseline.functions[STAGES]).toEqual({
      vStage: 500,
      wStage: 290,
      "vStage.map()": 200,
    });
  });

  it("refuses a stage past its function's entry, and a total past the allowance", () => {
    expect(
      recorded(old, measured({ vStage: 801 }, 460), [STAGES], YEAR, carry())
        .problems,
    ).toEqual([
      `${STAGES} vStage(): 801 lines, ${YEAR} runYear() 800 — split it; never raise the baseline`,
      `${YEAR}: the parts and what is left total 912 lines, entry 900 and +10 for the moved bodies — split it; never raise the baseline`,
    ]);
    // Without the carry a stage has no entry.
    expect(
      recorded(old, measured({ vStage: 500 }), [STAGES], YEAR).problems,
    ).toEqual([
      `${STAGES} vStage(): 500 lines, no entry in ${YEAR} — split it; never raise the baseline`,
      `${YEAR}: the parts and what is left total 902 lines, entry 900 — split it; never raise the baseline`,
    ]);
  });
});

describe("--record --from: a UI cut (owner v0.10.4 Q3)", () => {
  const ROW = "src/components/row.tsx";
  const PARTS = "src/components/row-parts.tsx";
  const was = [
    'import { Tip } from "./tip";',
    "",
    "export function Row({ yr }: Props) {",
    "  return (",
    "    <tr>",
    "      <Tip",
    "        content={(() => {",
    "          const n = yr.n;",
    "          return n * 2;",
    "        })()}",
    "      />",
    "      <td>{yr.a}</td>",
    "      <td>{yr.b}</td>",
    "    </tr>",
    "  );",
    "}",
  ].join("\n");
  const now = [
    'import { Tip } from "./tip";',
    'import { Cells, doubled } from "./row-parts";',
    "",
    "export function Row({ yr }: Props) {",
    "  return (",
    "    <tr>",
    "      <Tip content={doubled(yr)} />",
    "      <Cells yr={yr} />",
    "    </tr>",
    "  );",
    "}",
  ].join("\n");
  const parts = [
    "export function doubled(yr: Year) {",
    "  const n = yr.n;",
    "  return n * 2;",
    "}",
    "",
    "export function Cells({ yr }: { yr: Year }) {",
    "  return (",
    "    <>",
    "      <td>{yr.a}</td>",
    "      <td>{yr.b}</td>",
    "    </>",
    "  );",
    "}",
  ].join("\n");
  const tree = (files: Record<string, string>) => (f: string) => files[f];

  it("names the component each cut left, and what its function and call add", () => {
    // doubled: signature and brace (2), its call (1); Cells: signature,
    // `return (`, `<>`, `</>`, `);` and brace (6), its call (1); one import.
    expect(
      bodyCarry(
        ROW,
        [PARTS],
        tree({ [ROW]: now, [PARTS]: parts }),
        tree({ [ROW]: was }),
      ),
    ).toEqual({
      renames: {},
      wrapper: {},
      stages: { doubled: "Row", Cells: "Row" },
      total: 2 + 1 + 6 + 1 + 1,
    });
  });
});

describe("--record --from: a plain split's import lines (owner Q13)", () => {
  const DIR = "src/lib/pure/engine/withdrawal-routing/";
  /** A file of `lines` lines, the first `imports` of them imports. */
  const file = (lines: number, imports: number) =>
    Array.from({ length: lines }, (_, i) =>
      i < imports
        ? `import { a${i} } from "./m${i}";`
        : `export const x${i} = a0 + ${i};`,
    ).join("\n");
  const tree = (files: Record<string, string>) => (f: string) => files[f];
  /** v0.10.3 item 15: withdrawal-routing/index.ts (1,435 lines, 28 import
   *  lines) split into six parts; the seven files total 1,486, the split
   *  adding 57 import lines and dropping 6 lines of header and banner. */
  const PARTS: Record<string, [lines: number, imports: number]> = {
    "waterfall.ts": [158, 14],
    "percentage.ts": [209, 14],
    "bracket-filling.ts": [506, 21],
    "roth-bracket-overlay.ts": [70, 7],
    "caps.ts": [73, 5],
    "types.ts": [120, 4],
  };
  const INDEX = `${DIR}index.ts`;
  const split = (extra = 0) => {
    const sizes = Object.fromEntries(
      Object.entries(PARTS).map(([f, [lines, imports]]) => [
        DIR + f,
        { lines: f === "caps.ts" ? lines + extra : lines, imports },
      ]),
    );
    const parts = Object.keys(sizes);
    const now = tree({
      [INDEX]: file(350, 20),
      ...Object.fromEntries(
        parts.map((p) => [p, file(sizes[p]!.lines, sizes[p]!.imports)]),
      ),
    });
    const measured: Baseline = {
      files: {
        [INDEX]: 350,
        ...Object.fromEntries(parts.map((p) => [p, sizes[p]!.lines])),
      },
      functions: {},
    };
    const carry = bodyCarry(
      INDEX,
      parts,
      now,
      tree({ [INDEX]: file(1435, 28) }),
    );
    return recorded(
      { files: { [INDEX]: 1435 }, functions: {} },
      measured,
      parts,
      INDEX,
      carry,
    );
  };

  it("records item 15's real split, its parts over the entry by the import lines they add", () => {
    const result = split();
    expect(result.problems).toEqual([]);
    expect(result.baseline.files[`${DIR}bracket-filling.ts`]).toBe(506);
    expect(result.baseline.files[`${DIR}caps.ts`]).toBe(73);
  });

  it("refuses lines past the import lines: 1,492 passes, 1,493 doesn't", () => {
    expect(split(6).problems).toEqual([]);
    expect(split(7).problems).toEqual([
      `${INDEX}: the parts and what is left total 1493 lines, entry 1435 and +57 for the import lines it adds — split it; never raise the baseline`,
    ]);
  });

  it("allows exactly the import lines added, and no more", () => {
    const OLD = "src/a.ts";
    const PART = "src/a-part.ts";
    const was = file(500, 2);
    const go = (partLines: number) =>
      recorded(
        { files: { [OLD]: 500 }, functions: {} },
        { files: { [OLD]: 300, [PART]: partLines }, functions: {} },
        [PART],
        OLD,
        bodyCarry(
          OLD,
          [PART],
          tree({ [OLD]: file(300, 3), [PART]: file(partLines, 4) }),
          tree({ [OLD]: was }),
        ),
      ).problems;
    // Five import lines added (one in the old file, four in the part).
    expect(go(205)).toEqual([]);
    expect(go(206)).toEqual([
      `${OLD}: the parts and what is left total 506 lines, entry 500 and +5 for the import lines it adds — split it; never raise the baseline`,
    ]);
  });
});
