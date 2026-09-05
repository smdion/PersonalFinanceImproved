import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  IrmaaCliffAlert,
  type TaxYearRow,
} from "@/components/tax-optimization/irmaa-cliff-alert";
import { ReportAssumptionsSummary } from "@/components/cards/projection/report/report-assumptions-summary";

// --- trpc mock (RothExplorer / WithdrawalComparison use useQuery) ---
const rothWhatIfQuery = vi.fn();
const compareQuery = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    projection: {
      rothConversionWhatIf: {
        useQuery: (...a: unknown[]) => rothWhatIfQuery(...a),
      },
      compareWithdrawalStrategies: {
        useQuery: (...a: unknown[]) => compareQuery(...a),
      },
    },
  },
}));

// Import the query-driven components AFTER the mock is registered.
const { RothExplorer } =
  await import("@/components/tax-optimization/roth-explorer");
const { WithdrawalComparison } =
  await import("@/components/tax-optimization/withdrawal-comparison");

function row(overrides: Partial<TaxYearRow> = {}): TaxYearRow {
  return {
    year: 2054,
    age: 65,
    income: {
      socialSecurity: 0,
      traditionalWithdrawal: 40000,
      rothWithdrawal: 0,
      otherWithdrawal: 0,
      requiredMinimumDistribution: 0,
      rothConversion: 20000,
    },
    taxableSocialSecurity: 0,
    federalTax: 3500,
    niit: 0,
    irmaaSurcharge: 0,
    rothConversionTax: 2200,
    ltcgRate: 0.15,
    effectiveTaxRate: 0.087,
    cumulativeTax: 5700,
    endingBalance: 1000000,
    balanceByTaxType: {
      preTax: 500000,
      taxFree: 200000,
      afterTax: 300000,
      afterTaxBasis: 100000,
      hsa: 0,
    },
    qcdAmount: 0,
    rmdShortfall: 0,
    rmdExcess: 0,
    unmetNeed: 0,
    acaSubsidyPreserved: true,
    acaMagiHeadroom: 0,
    flags: ["Roth conversion"],
    ...overrides,
  };
}

describe("ReportAssumptionsSummary — IRMAA-capped note", () => {
  it("shows the note when irmaaCappedRothYears > 0 and hides it at 0", () => {
    const { rerender } = render(
      <ReportAssumptionsSummary settings={{}} irmaaCappedRothYears={3} />,
    );
    expect(
      screen.getByText(
        /3 years in this projection had Roth conversions capped/i,
      ),
    ).toBeInTheDocument();

    rerender(
      <ReportAssumptionsSummary settings={{}} irmaaCappedRothYears={0} />,
    );
    expect(
      screen.queryByText(/Roth conversions? capped/i),
    ).not.toBeInTheDocument();
  });
});

describe("IrmaaCliffAlert", () => {
  it("renders nothing when no year has IRMAA exposure", () => {
    const { container } = render(<IrmaaCliffAlert rows={[row()]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises surcharge years and capped-conversion years", () => {
    render(
      <IrmaaCliffAlert
        rows={[
          row({ age: 70, irmaaSurcharge: 1800 }),
          row({ age: 71, irmaaSurcharge: 1800 }),
          row({ age: 72, rothConversionIrmaaCapped: true }),
        ]}
      />,
    );
    expect(screen.getByText(/IRMAA\) surcharge exposure/i)).toBeInTheDocument();
    expect(
      screen.getByText(/2 years pay an IRMAA surcharge/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 year had a Roth conversion capped/i),
    ).toBeInTheDocument();
  });
});

describe("RothExplorer", () => {
  it("shows the engine's recommended conversion ceiling", () => {
    rothWhatIfQuery.mockReturnValue({
      data: {
        mode: "optimize",
        result: {
          recommendedTarget: 0.24,
          currentTarget: 0.22,
          candidates: [],
        },
      },
      isLoading: false,
    });
    render(<RothExplorer selection={{}} />);
    expect(
      screen.getByText(/Recommended conversion ceiling/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/24% marginal rate/)).toBeInTheDocument();
  });

  it("renders the bracket-ceiling comparison and marks best + current", () => {
    rothWhatIfQuery.mockReturnValue({
      data: {
        mode: "optimize",
        result: {
          recommendedTarget: 0.24,
          currentTarget: 0.22,
          candidates: [
            {
              target: 0.24,
              netCost: 500000,
              lifetimeTax: 300000,
              traditionalEnd: 900000,
              shortfallScore: 0,
              depleted: false,
            },
            {
              target: 0.22,
              netCost: 520000,
              lifetimeTax: 280000,
              traditionalEnd: 1090000,
              shortfallScore: 0,
              depleted: false,
            },
            {
              target: 0.32,
              netCost: 700000,
              lifetimeTax: 500000,
              traditionalEnd: 100000,
              shortfallScore: 0,
              depleted: true,
            },
          ],
        },
      },
      isLoading: false,
    });
    render(<RothExplorer selection={{}} />);
    expect(screen.getByText("best")).toBeInTheDocument();
    expect(screen.getByText("your setting")).toBeInTheDocument();
    expect(screen.getByText("depletes")).toBeInTheDocument();
  });
});

describe("WithdrawalComparison", () => {
  it("renders the strategy matrix and marks the cheapest", () => {
    compareQuery.mockReturnValue({
      data: {
        baselineLabel: "Tax-optimized",
        strategies: [
          {
            label: "Traditional first",
            mode: "waterfall",
            lifetimeTax: 120000,
            terminalByTaxType: {
              preTax: 1,
              taxFree: 2,
              afterTax: 3,
              afterTaxBasis: 0,
              hsa: 0,
            },
            depletedYear: null,
          },
          {
            label: "Tax-optimized",
            mode: "bracket_filling",
            lifetimeTax: 90000,
            terminalByTaxType: {
              preTax: 1,
              taxFree: 2,
              afterTax: 3,
              afterTaxBasis: 0,
              hsa: 0,
            },
            depletedYear: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<WithdrawalComparison selection={{}} />);
    expect(screen.getByText("Traditional first")).toBeInTheDocument();
    expect(screen.getByText("Tax-optimized")).toBeInTheDocument();
    expect(screen.getByText("lowest")).toBeInTheDocument();
  });

  it("annotates the preset that matches the household's real current plan", () => {
    const terminalByTaxType = {
      preTax: 1,
      taxFree: 2,
      afterTax: 3,
      afterTaxBasis: 0,
      hsa: 0,
    };
    compareQuery.mockReturnValue({
      data: {
        baselineLabel: "Your current plan",
        strategies: [
          {
            label: "Your current plan",
            mode: "bracket_filling",
            withdrawalOrder: [],
            isCurrentPlan: true,
            lifetimeTax: 90000,
            terminalByTaxType,
            depletedYear: null,
          },
          {
            label: "Traditional first",
            mode: "waterfall",
            lifetimeTax: 120000,
            terminalByTaxType,
            depletedYear: null,
          },
          {
            label: "Bracket Filling",
            mode: "bracket_filling",
            // Config match (same mode) AND output match (same
            // lifetimeTax/depletedYear as "Your current plan" above) —
            // this is the row that should get the annotation.
            lifetimeTax: 90000,
            terminalByTaxType,
            depletedYear: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<WithdrawalComparison selection={{}} />);
    expect(screen.getByText("(same as your current plan)")).toBeInTheDocument();
    // "Traditional first" has a different mode AND different numbers — no
    // annotation, and only one match should exist in the whole table.
    expect(screen.getAllByText("(same as your current plan)")).toHaveLength(1);
  });

  it("does not annotate a preset that shares a mode but not the resolved order or the numbers", () => {
    compareQuery.mockReturnValue({
      data: {
        baselineLabel: "Traditional first",
        strategies: [
          {
            label: "Your current plan",
            mode: "waterfall",
            // Deliberately NOT one of the two waterfall presets' orders.
            withdrawalOrder: ["hsa", "brokerage", "401k", "403b", "ira"],
            isCurrentPlan: true,
            lifetimeTax: 100000,
            terminalByTaxType: null,
            depletedYear: null,
          },
          {
            label: "Traditional first",
            mode: "waterfall",
            lifetimeTax: 95000,
            terminalByTaxType: null,
            depletedYear: null,
          },
          {
            label: "Brokerage first",
            mode: "waterfall",
            lifetimeTax: 105000,
            terminalByTaxType: null,
            depletedYear: null,
          },
        ],
      },
      isLoading: false,
    });
    render(<WithdrawalComparison selection={{}} />);
    expect(
      screen.queryByText("(same as your current plan)"),
    ).not.toBeInTheDocument();
  });
});
