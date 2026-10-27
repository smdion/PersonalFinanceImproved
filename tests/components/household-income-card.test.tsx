/**
 * Household Income card + its taxes line read household annual income:
 * the resolved bonus everywhere (the set bonus when there is one), the
 * formula shown beside it when they differ, and the household tax in the
 * projected and year-end views. Mocked at the trpc + primitive-hook layer,
 * like dashboard-living-costs-card.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let viewMode = "projected";
vi.mock("@/lib/context/scenario-context", () => ({
  useScenario: () => ({ activeScenario: null, viewMode }),
}));
vi.mock("@/lib/hooks/use-persisted-setting", () => ({
  usePersistedSetting: (_key: string, defaultValue: unknown) => [
    defaultValue,
    vi.fn(),
  ],
}));
vi.mock("@/components/ui/help-tip", () => ({ HelpTip: () => null }));

let user = { role: "viewer", name: "T", permissions: [] as string[] };
vi.mock("@/lib/context/user-context", () => ({
  useUser: () => user,
  isAdmin: (u: { role: string }) => u.role === "admin",
  hasPermission: (u: { role: string; permissions: string[] }, p: string) =>
    u.role === "admin" || u.permissions.includes(p),
}));

// One person, monthly pay. Salary $60,000; a SET bonus of $6,000 while the
// formula would give $9,000.
const bonusEstimate = (gross: number, net: number) => ({
  bonusGross: gross,
  bonusNet: net,
  bonusFederalWithholding: 0,
  bonusFica: 0,
  bonusContributions: 0,
  bonusFicaWages: gross,
});
const summary = {
  people: [
    {
      person: { id: 1, name: "Pat" },
      job: { bonusMonth: null, bonusDayOfMonth: null },
      salary: 60000,
      paycheck: {
        gross: 5000,
        netPay: 3800,
        periodsPerYear: 12,
        periodsElapsedYtd: 3,
        bonusEstimate: bonusEstimate(6000, 4300),
        federalWithholding: 600,
        ficaSS: 310,
        ficaMedicare: 72.5,
        // Withholding so far comes from the year schedule.
        yearSchedule: Array.from({ length: 12 }, () => ({
          federalWithholding: 600,
          ficaSS: 310,
          ficaMedicare: 72.5,
        })),
      },
      fullFormulaBonusEstimate: bonusEstimate(9000, 6450),
      resolvedBonusTerms: { bonusOverride: 6000 },
      blendedAnnual: { gross: 60000, netPay: 45600 },
    },
  ],
  householdIncome: {
    salary: 60000,
    bonus: 6000,
    gross: 66000,
    preTaxFederal: 3000,
    ficaWages: 66000,
    netRegular: 45600,
    netBonus: 4300,
    hsaOutsidePayroll: 0,
  },
  householdTax: {
    wageAgi: 63000,
    taxableIncome: 47250,
    additionalMedicare: 0,
    federalTax: 4000,
    ficaSS: 4092,
    ficaMedicare: 957,
    effectiveRate: 4000 / 63000,
    marginalRate: 0.12,
    totalTax: 9049,
    warnings: ["Additional Medicare Tax: example note"],
  },
  taxYear: 2026,
  filingStatus: "Single",
  filingStatusSource: "retirementProfile",
  // Fictional phase-out range.
  rothIra: {
    filingStatus: "Single",
    phaseOut: { start: 60_000, end: 75_000 },
    people: [
      {
        personId: 1,
        name: "Pat",
        compensation: 63000,
        iraLimit: 7000,
        hasEmployerPlan: true,
      },
    ],
  },
};
const rothInputs = {
  investmentIncome: {
    estimate: 4500,
    ytd: 3000,
    lastYearRemainder: 1500,
    basis: "ytdPlusLastYear",
    annualizedFeeds: [],
    noHistoryFeeds: [],
  },
  unlinkedFeedCount: 0,
  unfedTaxableAccounts: [],
  preTaxIraByPerson: [{ personId: 1, amount: 2500 }],
  unownedPreTaxIra: 0,
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      settings: { appSettings: { list: { invalidate: vi.fn() } } },
    }),
    settings: {
      appSettings: {
        list: { useQuery: () => ({ data: [] }) },
        upsert: {
          useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
        },
      },
    },
    salaryProfile: {
      list: { useQuery: () => ({ data: [] }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    contributionProfile: {
      list: { useQuery: () => ({ data: [] }) },
      setActive: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    paycheck: {
      computeSummary: {
        useQuery: () => ({ isLoading: false, error: null, data: summary }),
      },
    },
    investments: {
      getRothIraInputs: {
        useQuery: (_: unknown, opts: { enabled: boolean }) => ({
          isLoading: false,
          data: opts.enabled ? rothInputs : undefined,
        }),
      },
    },
  },
}));

import { HouseholdIncomeCard } from "@/components/cards/dashboard/household-income-card";
import { TaxesContent } from "@/app/(dashboard)/taxes/taxes-content";

describe("HouseholdIncomeCard", () => {
  beforeEach(() => {
    viewMode = "projected";
    user = { role: "viewer", name: "T", permissions: [] };
  });

  it("projected: headline is household annual income with the SET bonus, formula shown beside it", () => {
    render(<HouseholdIncomeCard />);
    expect(screen.getByText("$66,000.00")).toBeInTheDocument();
    expect(screen.getByText(/\$6,000\.00 gross/)).toBeInTheDocument();
    expect(screen.getByText(/Formula target \$9,000\.00/)).toBeInTheDocument();
    // Net = regular + bonus take-home.
    expect(screen.getByText("$49,900.00")).toBeInTheDocument();
  });

  it("projected and year-end taxes are the household tax; notes stay on the Taxes page", () => {
    for (const mode of ["projected", "blended"]) {
      viewMode = mode;
      const { unmount } = render(<HouseholdIncomeCard />);
      expect(screen.getByText("$9,049.00")).toBeInTheDocument();
      expect(
        screen.queryByText("Additional Medicare Tax: example note"),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it("without portfolio access: the wage AGI, no Roth verdict", () => {
    render(<HouseholdIncomeCard />);
    expect(screen.getByText("AGI from wages (est.)")).toBeInTheDocument();
    expect(screen.getByText("$63,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/Roth IRA MAGI/)).not.toBeInTheDocument();
  });

  it("with portfolio access: one Roth IRA line — MAGI and the verdict", () => {
    user = { role: "admin", name: "T", permissions: [] };
    render(<HouseholdIncomeCard />);
    // 63,000 wage AGI + 4,500 investment income, inside 60k–75k.
    expect(screen.getByText("$67,500.00")).toBeInTheDocument();
    expect(screen.getByText("Too close to call")).toBeInTheDocument();
    expect(screen.getByText("Roth IRA MAGI (est.)")).toBeInTheDocument();
    // The detail is on the Taxes page, not the card.
    expect(screen.queryByText(/pre-tax in IRAs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/range width/)).not.toBeInTheDocument();
  });

  it("YTD taxes are withholding so far, without the annual notes", () => {
    viewMode = "ytd";
    render(<HouseholdIncomeCard />);
    // (600 + 310 + 72.5) × 3 checks
    expect(screen.getByText("$2,947.50")).toBeInTheDocument();
    expect(
      screen.queryByText("Additional Medicare Tax: example note"),
    ).not.toBeInTheDocument();
  });
});

describe("Taxes page", () => {
  beforeEach(() => {
    user = { role: "viewer", name: "T", permissions: [] };
  });

  it("shows the tax line by line, with its notes", () => {
    render(<TaxesContent />);
    expect(screen.getByText("Federal income tax")).toBeInTheDocument();
    expect(screen.getByText("$9,049.00")).toBeInTheDocument();
    expect(
      screen.getByText("Additional Medicare Tax: example note"),
    ).toBeInTheDocument();
    // A viewer sees the filing status; an admin gets the editor.
    expect(screen.getByText("Filing status")).toBeInTheDocument();
    expect(screen.getAllByText("Single").length).toBeGreaterThan(0);
  });

  it("an admin sets this year's filing status; unset says what it follows", () => {
    user = { role: "admin", name: "T", permissions: [] };
    render(<TaxesContent />);
    const select = screen.getByLabelText("Filing status on this year's return");
    expect(select).toHaveDisplayValue("Single (the Retirement Profile's)");
  });

  it("with portfolio access: the full Roth IRA check", () => {
    user = { role: "admin", name: "T", permissions: [] };
    render(<TaxesContent />);
    expect(screen.getByText("$67,500.00")).toBeInTheDocument();
    // 7000 × (1 − 7,500/15,000) = 3,500
    expect(screen.getByText(/Pat \$3,500/)).toBeInTheDocument();
    expect(screen.getByText(/\$15,000 \(range width\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Pat has \$2,500 pre-tax in IRAs/),
    ).toBeInTheDocument();
  });
});
