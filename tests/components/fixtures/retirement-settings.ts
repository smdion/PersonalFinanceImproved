/**
 * Complete `computeProjection` settings and per-person rows for component
 * tests: an invented one-person household on the Fixed strategy, every
 * optional feature off. Tests spread overrides over these.
 */
import type {
  PerPersonSettings,
  Settings,
} from "@/components/retirement/sections/types";

type PersonSettings = NonNullable<PerPersonSettings>[number];

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    personId: 1,
    profileId: 1,
    retirementAge: 65,
    endAge: 95,
    retirementYear: 2040,
    ownRetirementAge: 65,
    ownEndAge: 95,
    returnAfterRetirement: "0.05",
    annualInflation: "0.03",
    postRetirementInflation: null,
    salaryAnnualIncrease: "0.03",
    brokerageContributionIncrease: 0,
    salaryCap: null,
    withdrawalRate: "0.04",
    taxMultiplier: "1.0",
    grossUpForTaxes: true,
    rothBracketTarget: null,
    enableRothConversions: false,
    rothConversionTarget: null,
    withdrawalStrategy: "fixed",
    discretionaryWithdrawalOrder: "roth_first",
    withdrawalRoutingMode: "bracket_filling",
    withdrawalOrder: null,
    withdrawalSplits: null,
    gkUpperGuardrail: "0.80",
    gkLowerGuardrail: "1.20",
    gkIncreasePct: "0.10",
    gkDecreasePct: "0.10",
    gkSkipInflationAfterLoss: true,
    sdAnnualDeclineRate: "0.02",
    cpWithdrawalPercent: "0.05",
    cpFloorPercent: "0.90",
    enWithdrawalPercent: "0.05",
    enRollingYears: 10,
    enFloorPercent: "0.90",
    vdBasePercent: "0.05",
    vdCeilingPercent: "0.05",
    vdFloorPercent: "0.025",
    rmdMultiplier: "1.0",
    vpwCap: null,
    vpwEndAge: null,
    cpSsInAmount: null,
    enSsInAmount: null,
    vdSsInAmount: null,
    rmdSsInAmount: null,
    vpwSsInAmount: null,
    rmdExcessHandling: "reinvest",
    rmdExcessTargetPerformanceAccountId: null,
    qcdMaximize: false,
    rmdSmoothingEnabled: false,
    rmdSmoothingMaxBracketTarget: null,
    socialSecurityMonthly: "2000",
    ssStartAge: 67,
    enableIrmaaAwareness: false,
    irmaaOnTopOfBudget: false,
    gapYearStopSaving: false,
    gapYearDraws: false,
    enableAcaAwareness: false,
    householdSize: 1,
    filingStatus: "Single",
    filingStatusExplicit: null,
    standardDeduction: null,
    ...overrides,
  };
}

export function makePersonSettings(
  overrides: Partial<PersonSettings> = {},
): PersonSettings {
  return {
    personId: 1,
    name: "Avery",
    birthYear: 1980,
    retirementAge: 65,
    endAge: 95,
    salaryAnnualIncrease: "0.03",
    socialSecurityMonthly: "2000",
    socialSecurityPia: null,
    ssStartAge: 67,
    ruleOf55Override: true,
    ...overrides,
  };
}
