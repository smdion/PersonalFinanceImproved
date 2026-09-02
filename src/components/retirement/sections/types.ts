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
  /** Which retirement profile this row belongs to — on the wire from
   *  computeProjection since `settings` is the raw DB row (Retirement
   *  Profiles phase 4). Null only for a pre-migration/never-backfilled
   *  household. Always forward this unchanged through `buildSettingsPatch`
   *  so household-grain edits stay scoped to the profile they're shown
   *  for, not whatever the household's globally-active profile happens to
   *  be — see retirementSettings.upsert's docblock. */
  profileId: number | null;
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
  /** R55 follow-up: within bracket_filling mode's cost-ranked tier, which
   *  of Roth basis / brokerage's 0%-LTCG room drains first. "roth_first"
   *  (default) or "brokerage_first" (explicit household opt-in — trades a
   *  real ACA/IRMAA MAGI cost for using the annual 0%-LTCG allowance
   *  sooner). */
  discretionaryWithdrawalOrder?: string | null;
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
  /** R46: what to do with RMD-forced withdrawal beyond stated spending
   *  need — "reinvest" (default) or "spend". */
  rmdExcessHandling?: string | null;
  /** R46: automatically maximize Qualified Charitable Distributions
   *  against the RMD each year (IRA-only, capped, approximation — see
   *  PLAN-rmd-excess-handling.md). */
  qcdMaximize?: boolean;
  /** R47: proactively size Roth conversions to shrink a future RMD toward
   *  projected spending need. Requires individual-account tracking. */
  rmdSmoothingEnabled?: boolean;
  /** R47: how far smoothing may elevate the effective conversion target
   *  rate above rothBracketTarget/rothConversionTarget — can only raise,
   *  never lower. Null/unset = UI should seed from rothBracketTarget. */
  rmdSmoothingMaxBracketTarget?: string | null;
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
  /** This person's EFFECTIVE pre-retirement raise rate (decimal string, e.g.
   *  "0.03"). Resolved server-side: their own `retirement_settings` rate for
   *  the active profile, or the primary person's rate when they have none.
   *  Written per-person via `retirementSettings.upsertPersonRaiseRate` (R53) —
   *  the single household "Pre-Retirement Raise" control only ever wrote the
   *  primary's row, leaving a second household member's rate unreachable. */
  salaryAnnualIncrease: string;
  socialSecurityMonthly: string;
  ssStartAge?: number | null;
  /** Rule of 55 forecasting override (v0.7.8) — true (default) = no
   *  override, false = force this person's employer-plan accounts
   *  ineligible for Rule of 55 regardless of computed job-separation
   *  status. See retirementSettings.ruleOf55Override's docblock in
   *  schema-pg.ts. */
  ruleOf55Override: boolean;
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

/** `retirementProfilePeople.upsertPerson` pass-through — per-person fields
 *  (Retirement Age, Rule of 55, SS Benefit, SS Start Age) that live on
 *  `retirement_profile_people`, not `retirement_settings`. */
export type UpsertProfilePersonMutation = {
  mutate: (input: {
    profileId: number;
    personId: number;
    retirementAge?: number;
    endAge?: number;
    socialSecurityMonthly?: string | null;
    ssStartAge?: number | null;
    ruleOf55Override?: boolean | null;
  }) => void;
};

/** `retirementSettings.upsertPersonRaiseRate` pass-through — writes ONLY
 *  `salary_annual_increase` for one (profile, person), used by the per-person
 *  "Pre-Retirement Raise" control when the household has more than one person
 *  (R53). `wholePercent` is a decimal string ("0.03"), same convention as
 *  `buildSettingsPatch`'s other percent fields. */
export type UpsertPersonRaiseRateMutation = {
  mutate: (input: {
    profileId: number;
    personId: number;
    salaryAnnualIncrease: string;
  }) => void;
};

/** `retirementProfilePeople.upsertHouseholdFields` pass-through — fields
 *  the UI presents as ONE household-wide control (Plan Through, SS Start
 *  Age) but that are stored per-person; fans the edit to every person in
 *  the profile server-side. */
export type UpsertProfileHouseholdFieldsMutation = {
  mutate: (input: {
    profileId: number;
    endAge?: number;
    ssStartAge?: number | null;
  }) => void;
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
};

/** Whether the current user may edit `retirement_settings` via
 *  `retirementSettings.upsert` (adminProcedure server-side). Sections use
 *  this to render read-only instead of hiding controls entirely — a
 *  non-admin can still see the values, just not change them. */
export type IsEditable = boolean;
