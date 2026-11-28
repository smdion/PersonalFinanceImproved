/**
 * The conversion variant: screens-e2e D with Roth conversions on, so a
 * converting household reaches the engine through the server path. It
 * converts while its Retirement brokerage can pay the conversion's tax,
 * holds its IRA in parts per owner, and has RMD smoothing on, so the
 * conversion's per-account side, the conversion's basis, each owner's Roth
 * parts and RMD-aware smoothing all run on a seeded household, not only on
 * engine fixtures.
 *
 * The projection's numbers are pinned in `__sync__/conversion/e2e-dc.json`
 * (the baseline rule in router-baseline.test.ts governs it;
 * `LEDGR_BASELINE_WRITE=1` writes it).
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTestCaller } from "../routers/setup";
import { HOUSEHOLDS } from "./households";
import { conversionVariant } from "./households-converting";
import { seedHousehold } from "./seed";
import { BASELINE_NOW, REGENERATE } from "./router-suite";
import { PROCEDURES, callProcedure } from "./procedures";
import { PIN_DIRS } from "./pin-runs";
import type { NumberTree } from "./numbers";
import { flatten, numberTree } from "./numbers";

const KEY = "e2e-dc";
const FILE = path.join(PIN_DIRS.sync, "conversion", `${KEY}.json`);

const projection = PROCEDURES.find(
  (p) => p.path === "projection.computeProjection",
)!;

type YearRow = {
  year: number;
  phase: string;
  rothConversionAmount?: number;
  rothConversionTaxCost?: number;
  rmdSmoothingShortfall?: number;
  rmdAmount?: number;
  individualAccountBalances: {
    category: string;
    taxType: string;
    ownerName?: string;
    parentCategory?: string;
    balance: number;
  }[];
};

let output: { result: { projectionByYear: YearRow[] } };

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
  );
  const { caller, cleanup } = await createTestCaller();
  try {
    const household = conversionVariant(
      HOUSEHOLDS.find((h) => h.key === "e2e-d")!,
    );
    const ids = await seedHousehold(caller, household);
    output = (await callProcedure(
      caller,
      projection,
      projection.input?.({ household, ids }),
    )) as typeof output;
  } finally {
    await cleanup();
  }
}, 120_000);
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe(`conversion variant: ${KEY}`, () => {
  const years = () => output.result.projectionByYear;
  const converting = () =>
    years().filter((y) => (y.rothConversionAmount ?? 0) > 0);

  it("pins the projection's numbers", () => {
    const numbers = numberTree(output);
    if (REGENERATE) {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, `${JSON.stringify(numbers)}\n`);
      return;
    }
    expect(
      fs.existsSync(FILE),
      `no baseline file ${path.relative(process.cwd(), FILE)}`,
    ).toBe(true);
    const pinned = JSON.parse(fs.readFileSync(FILE, "utf8")) as NumberTree;
    expect(flatten(numbers)).toEqual(flatten(pinned));
  });

  it("converts, paying the tax from its Retirement brokerage", () => {
    expect(converting().length).toBeGreaterThan(0);
    // Some years convert only the room that costs no tax (an empty
    // brokerage pays none, and a short one shrinks the conversion).
    expect(converting().some((y) => (y.rothConversionTaxCost ?? 0) > 0)).toBe(
      true,
    );
    const brokerage = (y: YearRow) =>
      y.individualAccountBalances.filter(
        (a) => a.category === "brokerage" && a.parentCategory === "Retirement",
      );
    expect(brokerage(converting()[0]!).length).toBeGreaterThan(0);
  });

  it("holds its IRA in parts per owner", () => {
    const ira = years()[0]!.individualAccountBalances.filter(
      (a) => a.category === "ira",
    );
    const parts = ira.map((a) => `${a.ownerName} ${a.taxType}`).sort();
    expect(parts).toEqual(["Alex preTax", "Sam preTax", "Sam taxFree"]);
  });

  it("runs RMD smoothing, then RMDs", () => {
    expect(years().some((y) => y.rmdSmoothingShortfall !== undefined)).toBe(
      true,
    );
    expect(years().some((y) => (y.rmdAmount ?? 0) > 0)).toBe(true);
  });
});
