/** Synthetic Milestones engine input for tests — made-up figures only. */
import { householdSavings } from "@/lib/pure/contributions";
import type {
  MilestoneInput,
  MilestoneProjectionYear,
  MilestoneYear,
} from "@/lib/pure/milestones";

export function makeYear(
  overrides: Partial<MilestoneYear> = {},
): MilestoneYear {
  return {
    year: 2026,
    isCurrent: true,
    age: 35,
    netWorth: 400_000,
    liquid: 300_000,
    cash: 30_000,
    retirement: 220_000,
    brokerage: 50_000,
    grossIncome: 150_000,
    contributions: null,
    wealthScore: 1.2,
    fiProgress: 0.2,
    mortgageBalance: 200_000,
    otherLiabilities: 0,
    ...overrides,
  };
}

/** A projection that compounds liquid at a fixed rate. */
export function makeProjection(
  fromYear: number,
  startLiquid: number,
  growthRate: number,
  startAge = 35,
  years = 40,
): MilestoneProjectionYear[] {
  return Array.from({ length: years }, (_, i) => ({
    year: fromYear + i,
    age: startAge + i,
    liquid: startLiquid * Math.pow(1 + growthRate, i),
    salary: startAge + i < 65 ? 150_000 : null,
    contributions: startAge + i < 65 ? 40_000 : null,
  }));
}

/** Money Guy savings figures; the breakdown is empty unless a test needs it. */
export function makeSavings(
  overrides: Partial<NonNullable<MilestoneInput["savings"]>> = {},
): NonNullable<MilestoneInput["savings"]> {
  return {
    rate: 0.22,
    retirementRate: 0.22,
    saved: 33_000,
    savedWithMatch: 38_000,
    compensation: 150_000,
    matchCounted: true,
    highIncome: false,
    highIncomeThreshold: 200_000,
    breakdown: householdSavings([], [], "projected", { excludeMatch: false }),
    ...overrides,
  };
}

export function makeInput(
  overrides: Partial<MilestoneInput> = {},
): MilestoneInput {
  return {
    asOfYear: 2026,
    years: [
      makeYear({
        year: 2024,
        isCurrent: false,
        age: 33,
        netWorth: 250_000,
        liquid: 180_000,
        retirement: 140_000,
        brokerage: 20_000,
        contributions: 35_000,
        wealthScore: 1.0,
        fiProgress: 0.12,
      }),
      makeYear({
        year: 2025,
        isCurrent: false,
        age: 34,
        netWorth: 320_000,
        liquid: 240_000,
        retirement: 180_000,
        brokerage: 35_000,
        contributions: 38_000,
        wealthScore: 1.1,
        fiProgress: 0.16,
      }),
      makeYear(),
    ],
    projection: {
      years: makeProjection(2026, 300_000, 0.1),
      inflationRate: 0.03,
      isScenario: false,
    },
    fiTarget: 1_500_000,
    savings: makeSavings(),
    match: { captured: 5_000, available: 5_000 },
    limits: [
      {
        fooStep5: true,
        retirement: true,
        owner: "Pat",
        label: "IRA",
        contributed: 7_000,
        limit: 7_000,
      },
      {
        fooStep5: true,
        retirement: true,
        owner: "Household",
        label: "HSA",
        contributed: 8_550,
        limit: 8_550,
      },
      {
        fooStep5: false,
        retirement: true,
        owner: "Pat",
        label: "401k",
        contributed: 15_000,
        limit: 23_500,
      },
    ],
    retirementUnlimited: 0,
    efundMonths: 4,
    mortgage: { active: true, monthlyHousingCost: 2_500, payoffYear: 2045 },
    holdings: null,
    checklist: {},
    customGoals: [],
    checkpointSource: "moneyGuy",
    savingsTargetSource: "moneyGuy",
    megaBackdoor: null,
    brokerageGoals: null,
    ...overrides,
  };
}
