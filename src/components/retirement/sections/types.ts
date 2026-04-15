/**
 * Shared prop types for retirement-content.tsx section components.
 *
 * These are hand-rolled because src/components/** is lint-forbidden from
 * importing @/server/* (no-restricted-imports rule at eslint.config.mjs).
 * The parent `retirement-content.tsx` guards on `data.settings` presence
 * before rendering, so we narrow to the "loaded" branch at the prop
 * boundary — sections never see null settings.
 *
 * Extracted during the v0.5.2 file-split refactor (PRs 7-8).
 */

/** Full retirement settings row shape, matching the `settings` field that
 *  computeProjection returns after the payload-present guard. Decimal fields
 *  are serialized as strings because Drizzle + decimal columns round-trip
 *  through JSON as string. */
export type Settings = {
  personId: number;
  retirementAge: number;
  endAge: number;
  returnAfterRetirement: string;
  annualInflation: string;
  postRetirementInflation?: string | null;
  salaryAnnualIncrease: string;
  salaryCap?: string | null;
  raisesDuringRetirement?: boolean;
  withdrawalRate: string;
  taxMultiplier: string;
  grossUpForTaxes?: boolean;
  rothBracketTarget?: string | null;
  socialSecurityMonthly: string;
  ssStartAge: number;
  enableRothConversions?: boolean;
  rothConversionTarget?: string | null;
  withdrawalStrategy: string;
  // Strategy-specific params
  gkUpperGuardrail?: string | null;
  gkLowerGuardrail?: string | null;
  gkIncreasePct?: string | null;
  gkDecreasePct?: string | null;
  gkSkipInflationAfterLoss?: boolean;
  sdAnnualDeclineRate?: string | null;
  cpWithdrawalPercent?: string | null;
  cpFloorPercent?: string | null;
  enWithdrawalPercent?: string | null;
  enRollingYears?: number | null;
  enFloorPercent?: string | null;
  vdBasePercent?: string | null;
  vdCeilingPercent?: string | null;
  vdFloorPercent?: string | null;
  rmdMultiplier?: string | null;
  // Feature flags + filing
  enableIrmaaAwareness?: boolean;
  enableAcaAwareness?: boolean;
  householdSize?: number;
  filingStatus?: string | null;
  filingStatusExplicit?: string | null;
};

/** Per-person retirement overrides — present when household has >1 person.
 *  Nullable at the parent layer so sections handle both cases. */
export type PerPersonSettings = ReadonlyArray<{
  personId: number;
  name: string;
  birthYear: number;
  retirementAge: number;
  endAge: number | null;
  socialSecurityMonthly: string;
  ssStartAge?: number | null;
}> | null;

/** Typed payload for `retirementSettings.upsert`. The six required fields
 *  anchor the row; all other Settings fields are optional overrides.
 *  Defined here (component layer) to avoid importing from @/server/*. */
export type UpsertSettingsInput = {
  personId: number;
  retirementAge: number;
  endAge: number;
  returnAfterRetirement: string;
  annualInflation: string;
  salaryAnnualIncrease: string;
} & Partial<Settings>;

/** The upsert mutation pass-through. Sections only need `.mutate(...)` —
 *  the parent owns the optimistic update pipeline. */
export type UpsertSettingsMutation = {
  mutate: (input: UpsertSettingsInput) => void;
};

/** Selected retirement scenario — used by Taxes section for per-account-type
 *  distribution tax rates. Nullable when no scenario is active. */
export type SelectedScenario = {
  distributionTaxRateTraditional: string;
  distributionTaxRateRoth: string;
  distributionTaxRateBrokerage: string;
} | null;

/** Return-rate summary — used by Glide Path section. */
export type ReturnRateSummary = {
  currentRate: number | null;
  retirementRate: number | null;
  postRetirementRate: number | null;
  avgAccumulation: number;
  schedule: ReadonlyArray<{ age: number; rate: number }>;
} | null;

/** Budget profile summaries — used by Per-Phase Budget section. */
export type BudgetProfileSummaries = ReadonlyArray<{
  id: number;
  name: string;
  isActive: boolean;
  columnLabels: string[];
  columnMonths: number[] | null;
  columnTotals: number[];
  weightedAnnualTotal: number | null;
}>;

/** Contribution profile list entry — used by Income section. */
export type ContribProfileListEntry = {
  id: number;
  name: string;
  isDefault?: boolean;
};
