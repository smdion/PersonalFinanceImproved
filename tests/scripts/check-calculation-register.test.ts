/**
 * scripts/check-calculation-register.ts keeps docs/CALCULATIONS.md the
 * register of every calculation: each calculator, engine and lib/pure
 * export has a row (the ones without one today may only shrink), and the
 * high-risk rows with no independent test may only shrink. Checked on a
 * small invented register, then on the real one.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  BASELINE_FILE,
  coveredExports,
  registerProblems,
  valueExports,
  type RegisterBaseline,
} from "../../scripts/check-calculation-register";
import {
  CALCULATIONS_DOC,
  missingPaths,
} from "../../scripts/calculations-tested";

const DOC = [
  "| Id     | Computes | Function | Authority | Test |",
  "| ------ | -------- | -------- | --------- | ---- |",
  "| TAX-01 | Tax | `lib/calculators/tax.ts:taxOf`, `bracketsFor` | IRC § 1 | `calculators/tax.test.ts`: independent |",
  "| TAX-02 | Credit | `lib/pure/credit.ts:creditOf` | IRC § 24 | `pure/credit.test.ts`: self-derived |",
  "| HH-01  | Rate | `lib/pure/rate.ts:rateOf` | Arithmetic | `pure/rate.test.ts`: bound |",
].join("\n");

const EXPORTS = [
  "src/lib/calculators/tax.ts:bracketsFor",
  "src/lib/calculators/tax.ts:taxOf",
  "src/lib/pure/credit.ts:creditOf",
  "src/lib/pure/rate.ts:rateOf",
];

const BASELINE: RegisterBaseline = {
  risk: { "TAX-01": "H", "TAX-02": "H", "HH-01": "L" },
  highRiskWithoutIndependentTest: ["TAX-02"],
  exportsWithoutRow: [],
};

describe("valueExports", () => {
  it("lists functions, variables, classes and enums, not types or re-exports", () => {
    const src = [
      "export function taxOf() {}",
      "export const RATE = 0.1, cap = (x: number) => x;",
      "export class Err extends Error {}",
      "export enum Kind { A }",
      "export type T = number;",
      "export interface I {}",
      "const local = 1; type U = 2;",
      "export { local, type U };",
      'export { other } from "./other";',
      'export * from "./all";',
      "function hidden() {}",
    ].join("\n");
    expect(valueExports(src)).toEqual([
      "taxOf",
      "RATE",
      "cap",
      "Err",
      "Kind",
      "local",
    ]);
  });
});

describe("registerProblems", () => {
  it("passes a register that matches its baseline", () => {
    expect(registerProblems(DOC, EXPORTS, BASELINE)).toEqual([]);
  });

  it("fails an export with no row", () => {
    expect(
      registerProblems(
        DOC,
        [...EXPORTS, "src/lib/calculators/tax.ts:newFigure"],
        BASELINE,
      ),
    ).toEqual([
      expect.stringMatching(
        /^src\/lib\/calculators\/tax\.ts:newFigure: exported with no row/,
      ),
    ]);
  });

  it("fails a listed export that now has a row or is gone (shrink-only)", () => {
    const problems = registerProblems(DOC, EXPORTS, {
      ...BASELINE,
      exportsWithoutRow: ["src/lib/pure/rate.ts:rateOf"],
    });
    expect(problems).toEqual([
      expect.stringMatching(
        /^src\/lib\/pure\/rate\.ts:rateOf: now has a row or isn't exported/,
      ),
    ]);
  });

  it("fails a new high-risk row with no independent test", () => {
    const problems = registerProblems(DOC, EXPORTS, {
      ...BASELINE,
      risk: { ...BASELINE.risk, "HH-01": "H" },
    });
    expect(problems).toEqual([
      expect.stringMatching(/^HH-01: a high-risk row with no independent test/),
    ]);
  });

  it("fails a listed row that got an independent test (shrink-only)", () => {
    const doc = DOC.replace(
      "`pure/credit.test.ts`: self-derived",
      "`pure/credit.test.ts`: independent (Pub 972)",
    );
    expect(registerProblems(doc, EXPORTS, BASELINE)).toEqual([
      expect.stringMatching(/^TAX-02: no longer a high-risk row/),
    ]);
  });

  it("reads 'not independent' as no independent test", () => {
    const doc = DOC.replace(
      "`calculators/tax.test.ts`: independent",
      "`calculators/tax.test.ts`: self-derived, not independent",
    );
    expect(registerProblems(doc, EXPORTS, BASELINE)).toEqual([
      expect.stringMatching(/^TAX-01: a high-risk row with no independent/),
    ]);
  });

  it("fails an unrated row, a rating with no row, and a row with no Authority", () => {
    const doc = DOC.replace("| Arithmetic |", "|  |").concat(
      "\n| SIM-01 | Trials | `lib/pure/rate.ts:rateOf` | Owner design | `pure/rate.test.ts`: bound |",
    );
    const problems = registerProblems(doc, EXPORTS, {
      ...BASELINE,
      risk: { ...BASELINE.risk, "ENG-09": "M" },
    });
    expect(problems).toEqual([
      expect.stringMatching(/^HH-01 \(line 5\): no Authority/),
      expect.stringMatching(/^SIM-01: no risk/),
      expect.stringMatching(/^ENG-09: rated in .* but not a row/),
    ]);
  });
});

describe("the real register", () => {
  it("passes against its baseline today", () => {
    const doc = fs.readFileSync(CALCULATIONS_DOC, "utf8");
    const baseline = JSON.parse(
      fs.readFileSync(BASELINE_FILE, "utf8"),
    ) as RegisterBaseline;
    expect(missingPaths(doc)).toEqual([]);
    expect(registerProblems(doc, coveredExports(), baseline)).toEqual([]);
  });
});
