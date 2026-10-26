/**
 * The "tax data is behind" rule: a table is behind only after its usual
 * publication date has passed without the year arriving.
 */
import { describe, it, expect } from "vitest";
import {
  expectedTaxYear,
  taxDataStatus,
  taxYearDeadline,
} from "@/lib/pure/tax-data-status";

const all = (years: number[]) => ({
  contribution_limits: years,
  tax_brackets: years,
  ltcg_brackets: years,
  irmaa_brackets: years,
  fpl_by_household: years,
});

describe("expectedTaxYear / taxYearDeadline", () => {
  it("IRS figures for next year are due Nov 30 this year; poverty levels Jan 31 of the year", () => {
    expect(taxYearDeadline(2027, { month: 11, day: 30 }).toDateString()).toBe(
      new Date(2026, 10, 30).toDateString(),
    );
    expect(taxYearDeadline(2027, { month: 1, day: 31 }).toDateString()).toBe(
      new Date(2027, 0, 31).toDateString(),
    );
    expect(expectedTaxYear({ month: 11, day: 30 }, new Date(2026, 9, 25))).toBe(
      2026,
    );
    expect(expectedTaxYear({ month: 11, day: 30 }, new Date(2026, 11, 2))).toBe(
      2027,
    );
  });
});

describe("taxDataStatus", () => {
  it("in October with this year's data: current, next year coming", () => {
    const s = taxDataStatus(
      { yearsByTable: all([2025, 2026]) },
      new Date(2026, 9, 25),
    );
    expect(s.needsAttention).toBe(false);
    expect(s.summary).toBeNull();
    expect(s.sections[0]!.upcoming?.year).toBe(2027);
  });

  it("in December without next year's IRS figures: behind", () => {
    const s = taxDataStatus(
      { yearsByTable: { ...all([2026]), fpl_by_household: [2026] } },
      new Date(2026, 11, 5),
    );
    const behind = s.sections.filter((x) => x.behind).map((x) => x.table);
    // Poverty levels for 2027 aren't due until January.
    expect(behind).toEqual([
      "contribution_limits",
      "tax_brackets",
      "ltcg_brackets",
      "irmaa_brackets",
    ]);
    expect(s.summary).toBe("2027 tax data not in yet");
  });

  it("carried-forward figures to confirm need attention too", () => {
    const s = taxDataStatus(
      {
        yearsByTable: all([2026, 2027]),
        carried: [
          { table: "contribution_limits", taxYear: 2027, name: "ira_limit" },
        ],
      },
      new Date(2026, 11, 5),
    );
    expect(s.summary).toBe("1 carried-forward figure to confirm");
  });
});
