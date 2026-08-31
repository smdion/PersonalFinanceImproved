/* eslint-disable no-restricted-syntax -- as unknown as casts required to build minimal EngineDecumulationYear fixtures without satisfying every unrelated field of the full engine type */
import { describe, it, expect } from "vitest";
import { buildYearTableRows } from "@/lib/pure/report/year-table";
import type { EngineDecumulationYear } from "@/lib/calculators/types/engine-projection";

const noopDeflate = (v: number) => v;

function decumYear(
  overrides: Partial<EngineDecumulationYear> = {},
): EngineDecumulationYear {
  return {
    year: 2040,
    age: 65,
    phase: "decumulation",
    totalWithdrawal: 50000,
    taxCost: 5000,
    rmdOverrodeRouting: false,
    rmdShortfallAmount: 0,
    irmaaCost: 0,
    acaSubsidyPreserved: true,
    rothConversionAmount: 0,
    ...overrides,
  } as unknown as EngineDecumulationYear;
}

describe("buildYearTableRows", () => {
  it("formats withdrawal and tax as currency", () => {
    const rows = buildYearTableRows([decumYear()], noopDeflate);
    expect(rows[0]).toMatchObject({
      year: 2040,
      age: 65,
      withdrawal: "$50,000.00",
      taxCost: "$5,000.00",
      flags: [],
    });
  });

  it("flags RMD-forced years distinctly from RMD shortfall years", () => {
    const rows = buildYearTableRows(
      [
        decumYear({ year: 2041, rmdOverrodeRouting: true }),
        decumYear({ year: 2042, rmdShortfallAmount: 1000 }),
      ],
      noopDeflate,
    );
    expect(rows[0]!.flags).toEqual(["RMD"]);
    expect(rows[1]!.flags).toEqual(["RMD shortfall"]);
  });

  it("collects multiple flags for the same year", () => {
    const rows = buildYearTableRows(
      [
        decumYear({
          irmaaCost: 500,
          acaSubsidyPreserved: false,
          rothConversionAmount: 10000,
        }),
      ],
      noopDeflate,
    );
    expect(rows[0]!.flags).toEqual(["IRMAA", "ACA lost", "Roth conversion"]);
  });

  it("produces no flags for an unremarkable year", () => {
    const rows = buildYearTableRows([decumYear()], noopDeflate);
    expect(rows[0]!.flags).toHaveLength(0);
  });
});
