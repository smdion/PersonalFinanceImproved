import { describe, it, expect } from "vitest";
import {
  raiseHistory,
  meetsRaiseRule,
} from "@/lib/pure/household/raise-history";

const pay = (entries: [number, number][]) => new Map(entries);
const saved = (entries: [number, number, boolean?][]) =>
  new Map(
    entries.map(([y, employee, estimated]) => [
      y,
      { employee, estimated: estimated ?? false },
    ]),
  );

describe("raiseHistory", () => {
  it("each raise: the saving change over the salary change", () => {
    const r = raiseHistory(
      pay([
        [2022, 100_000],
        [2023, 110_000],
        [2024, 120_000],
      ]),
      saved([
        [2022, 20_000],
        [2023, 26_000],
        [2024, 28_000],
      ]),
    );
    expect(r).toEqual([
      {
        year: 2023,
        raise: 10_000,
        savingChange: 6_000,
        share: 0.6,
        estimated: false,
      },
      {
        year: 2024,
        raise: 10_000,
        savingChange: 2_000,
        share: 0.2,
        estimated: false,
      },
    ]);
    expect(r.map(meetsRaiseRule)).toEqual([true, false]);
  });

  it("saving less after a raise is a negative share", () => {
    const [r] = raiseHistory(
      pay([
        [2022, 100_000],
        [2023, 110_000],
      ]),
      saved([
        [2022, 20_000],
        [2023, 15_000],
      ]),
    );
    expect(r!.share).toBe(-0.5);
    expect(meetsRaiseRule(r!)).toBe(false);
  });

  it("skips pay cuts, tiny changes, the first year and years without contributions", () => {
    expect(
      raiseHistory(
        pay([
          [2020, 100_000],
          [2021, 90_000], // pay cut
          [2022, 90_500], // under 1% of last year's
          [2023, 120_000], // no 2023 contributions
          [2024, 130_000],
        ]),
        saved([
          [2020, 10_000],
          [2021, 10_000],
          [2022, 10_000],
          [2024, 20_000],
        ]),
      ),
    ).toEqual([]);
  });

  it("an estimated year on either side marks the raise", () => {
    const [r] = raiseHistory(
      pay([
        [2022, 100_000],
        [2023, 110_000],
      ]),
      saved([
        [2022, 20_000, true],
        [2023, 27_000],
      ]),
    );
    expect(r!.estimated).toBe(true);
  });
});
