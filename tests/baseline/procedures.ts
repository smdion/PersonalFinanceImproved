/**
 * Every tRPC query a household can call, with the input the baseline calls
 * it with, and the queries it leaves out with the reason. The suites check
 * that the two lists together are exactly the app router's queries, so a
 * new query fails until it's added to one of them. Mutations are out: the
 * seeder writes through them, and part d pins the rows sync writes.
 */
import type { Caller, Household, SeededIds } from "./seed";

/** What a procedure's input is built from. */
export interface ProcedureContext {
  household: Household;
  ids: SeededIds;
}

export interface BaselineProcedure {
  /** The router path, e.g. `projection.computeProjection`. */
  path: string;
  /** Distinguishes two calls of one path; part of the file name. */
  variant?: string;
  /** The input, or `undefined` for a query without one. Returning `null`
   *  means this household has nothing to call it with (no mortgage for a
   *  loan's procedure, no Social Security to sweep): no file is written. */
  input?: (ctx: ProcedureContext) => unknown;
}

/** Inputs every tool page sends: the active profiles, no overrides. */
const relocation = ({ ids }: ProcedureContext) => ({
  currentProfileId: ids.budgetProfile,
  currentBudgetColumn: 0,
  currentExpenseOverride: null,
  relocationProfileId: ids.budgetProfile,
  relocationBudgetColumn: 0,
  // An invented destination budget, so the two sides differ.
  relocationExpenseOverride: 4000,
  yearAdjustments: [],
  largePurchases: [],
  currentContributionProfileId: ids.contributionProfile,
  relocationContributionProfileId: ids.contributionProfile,
});

const primary = ({ household, ids }: ProcedureContext) => {
  const person = household.people.find((p) => p.isPrimaryUser)!;
  return { key: person.key, id: ids.people[person.key]! };
};

const loan = (build: (loanId: number) => unknown) => (ctx: ProcedureContext) =>
  ctx.ids.mortgage == null ? null : build(ctx.ids.mortgage);

const none = () => ({});

/** The active Contribution and Salary Profiles, which every page sends
 *  (useEffectiveContribProfileId, useEffectiveSalaryProfileId). */
const active = ({ ids }: ProcedureContext) => ({
  contributionProfileId: ids.contributionProfile,
  salaryProfileId: ids.salaryProfile,
});

export const PROCEDURES: BaselineProcedure[] = [
  { path: "settings.people.list" },
  { path: "settings.jobs.list" },
  { path: "settings.contributionAccounts.list" },
  { path: "settings.earnings.list" },
  { path: "settings.deductions.list" },
  { path: "settings.taxData.sectionSources" },
  { path: "settings.taxData.status" },
  { path: "settings.contributionLimits.list" },
  { path: "settings.taxBrackets.list" },
  { path: "settings.ltcgBrackets.list" },
  { path: "settings.irmaaBrackets.list" },
  { path: "settings.fplByHousehold.list" },
  { path: "settings.getDataFreshness" },
  { path: "settings.appSettings.list" },
  { path: "settings.rbacGroups.get" },
  { path: "settings.scenarios.list" },
  { path: "settings.apiConnections.list" },
  { path: "settings.isOnboardingComplete" },
  { path: "settings.firstRunState" },
  { path: "settings.taxDataSync.status" },
  { path: "paycheck.computeSummary", input: active },
  // As an API caller without the page's ids gets it: no Contribution
  // Profile is applied (see the v0.10.0 report).
  { path: "paycheck.computeSummary", variant: "no-ids", input: none },
  { path: "budget.listProfiles" },
  { path: "budget.computeActiveSummary", input: none },
  {
    path: "budget.mortgageItemChoices",
    input: loan((loanId) => ({ loanId })),
  },
  { path: "budget.listContribAccountsForLinking" },
  { path: "budget.listApiCategories", input: none },
  { path: "budget.listApiActuals", input: none },
  { path: "contribution.highIncomeLine" },
  { path: "contribution.computeSummary", input: active },
  { path: "mortgage.computeActiveSummary" },
  { path: "mortgage.mortgageLoans.list" },
  { path: "mortgage.mortgageWhatIfScenarios.list" },
  { path: "mortgage.mortgageExtraPayments.list" },
  { path: "networth.computeSummary", input: none },
  { path: "networth.listHistory", input: none },
  { path: "networth.computeDetailedHistory", input: none },
  {
    path: "networth.listSnapshots",
    input: () => ({ page: 1, pageSize: 52 }),
  },
  { path: "networth.listSnapshotTotals" },
  {
    path: "networth.computeComparison",
    input: () => ({
      dateFrom: "2026-01-01",
      dateTo: "2026-03-07",
      useMarketValue: true,
    }),
  },
  { path: "networth.portfolioSnapshots.getLatest" },
  { path: "milestones.computeInputs", input: none },
  { path: "milestones.firstReached" },
  { path: "savings.computeSummary", input: none },
  { path: "savings.plannedTransactions.getSettlementSuggestions" },
  {
    path: "savings.goalProfileAllocations.list",
    input: ({ ids }) => ({ profileId: ids.budgetProfile }),
  },
  { path: "savings.goalProfileAllocations.listSummaries" },
  { path: "savings.listApiBalances" },
  { path: "savings.listEfundReimbursements" },
  { path: "savings.extraPaycheckRouting.list" },
  { path: "savings.getMonthlyHistory" },
  { path: "savings.savingsGoals.list" },
  { path: "brokerage.listGoals" },
  { path: "brokerage.computeSummary" },
  { path: "retirement.computeRelocationAnalysis", input: relocation },
  { path: "retirement.retirementProfilePeople.list" },
  { path: "retirement.retirementSettings.list" },
  { path: "retirement.retirementSalaryOverrides.list" },
  { path: "retirement.retirementBudgetOverrides.list" },
  ...(["accumulation", "decumulation", "brokerage"] as const).map(
    (overrideType) => ({
      path: "retirement.projectionOverrides.get",
      variant: overrideType,
      input: () => ({ overrideType }),
    }),
  ),
  { path: "retirement.retirementProfiles.list" },
  { path: "retirement.returnRates.list" },
  { path: "projection.computeProjection", input: active },
  { path: "projection.computeCoastFire", input: active },
  { path: "projection.computeCoastFireMC", input: active },
  {
    path: "projection.computeCoastFireProbe",
    // Five years from now, or the last working year if sooner; a
    // household already retired has no age to probe.
    input: (ctx) => {
      const { key } = primary(ctx);
      const person = ctx.household.people.find((p) => p.key === key)!;
      const age = 2026 - Number(person.dateOfBirth.slice(0, 4));
      const retirementAge = ctx.household.retirement[key]!.retirementAge;
      const probeAge = Math.min(age + 5, retirementAge - 1);
      return probeAge >= age ? { ...active(ctx), probeAge } : null;
    },
  },
  {
    path: "projection.computeMonteCarloProjection",
    input: (ctx) => ({ ...active(ctx), numTrials: 100, seed: 31 }),
  },
  { path: "projection.computeStrategyComparison", input: active },
  { path: "projection.analyzeStrategy", input: active },
  { path: "projection.computeStressTest", input: active },
  {
    path: "projection.computeRelocationFiProjection",
    input: (ctx) => ({
      ...relocation(ctx),
      salaryProfileId: ctx.ids.salaryProfile,
      moveYear: null,
    }),
  },
  { path: "projection.relocationScenarios.list" },
  { path: "projection.projectTaxYears", input: active },
  {
    path: "projection.compareWithdrawalStrategies",
    // The three the Tax optimization page compares.
    input: (ctx) => ({
      ...active(ctx),
      strategies: [
        {
          label: "Traditional first",
          mode: "waterfall",
          order: ["401k", "403b", "ira", "brokerage", "hsa"],
        },
        {
          label: "Brokerage first",
          mode: "waterfall",
          order: ["brokerage", "401k", "403b", "ira", "hsa"],
        },
        { label: "Bracket filling", mode: "bracket_filling" },
      ],
    }),
  },
  {
    path: "projection.rothConversionWhatIf",
    variant: "optimize",
    input: (ctx) => ({ ...active(ctx), mode: "optimize" }),
  },
  {
    path: "projection.rothConversionWhatIf",
    variant: "explicit",
    input: (ctx) => ({
      ...active(ctx),
      mode: "explicit",
      conversionTargets: [{ year: 2027, targetRate: 0.22 }],
    }),
  },
  { path: "projection.computeWithdrawalBracketOptimizer", input: active },
  {
    path: "projection.sweepSocialSecurityClaimingAges",
    input: (ctx) => {
      const { key, id } = primary(ctx);
      const pia = Number(ctx.household.retirement[key]?.ssMonthly ?? 0);
      return pia > 0 ? { ...active(ctx), personId: id, pia } : null;
    },
  },
  { path: "performance.computeSummary" },
  { path: "performance.performanceAccounts.list" },
  { path: "historical.computeSummary", input: none },
  { path: "assets.computeSummary", input: none },
  {
    path: "assets.listPropertyTaxes",
    input: loan((loanId) => ({ loanId })),
  },
  { path: "utilities.listServices" },
  { path: "utilities.computeSummary" },
  { path: "utilities.listBudgetApiCategories" },
  { path: "utilities.previewBudgetApiFeed" },
  { path: "debts.list" },
  { path: "debts.summary" },
  { path: "version.list" },
  { path: "version.getRetention" },
  { path: "version.getSchedule" },
  { path: "version.getUpgradeBanner" },
  { path: "contributionProfile.list" },
  { path: "contributionProfile.compareData" },
  {
    path: "contributionProfile.getById",
    input: ({ ids }) => ({ id: ids.contributionProfile }),
  },
  { path: "salaryProfile.list" },
  {
    path: "salaryProfile.getById",
    input: ({ ids }) => ({ id: ids.salaryProfile }),
  },
  { path: "sync.getConnection" },
  { path: "sync.getSyncStatus" },
  {
    path: "sync.computeExpenseComparison",
    input: () => ({
      currentStart: "2026-02-01",
      currentEnd: "2026-02-28",
      priorStart: "2026-01-01",
      priorEnd: "2026-01-31",
    }),
  },
  { path: "sync.getActiveBudgetApi" },
  { path: "sync.getActiveBudgetApiLink" },
  { path: "simplefin.getStatus" },
  { path: "simplefin.getCollectionStats" },
  { path: "simplefin.listAccounts" },
  { path: "simplefin.listMatchableAccounts" },
  { path: "simplefin.listLinkableLoans" },
  { path: "simplefin.listBalanceHistory", input: () => ({ days: 30 }) },
  { path: "tiingo.getStatus" },
  { path: "investments.getHealth" },
  {
    path: "investments.getSnapshotFlows",
    input: () => ({ since: "2026-01-01" }),
  },
  {
    path: "investments.getYearReturnRanges",
    input: () => ({ preset: "default", years: [2026, 2030, 2040] }),
  },
  { path: "investments.getComparison", input: none },
  { path: "investments.getSimulationGlidePaths" },
  { path: "investments.getHoldingsOverview" },
  { path: "investments.suggestSnapshot" },
  {
    path: "investments.suggestPerformance",
    input: () => ({ year: 2026 }),
  },
  { path: "investments.getSavingsThisYear" },
  { path: "investments.suggestBasis", input: () => ({ year: 2026 }) },
  { path: "investments.getAccountInsights" },
  { path: "investments.getLiveSinceSnapshot" },
  {
    path: "investments.getRothIraInputs",
    input: () => ({ taxYear: 2026 }),
  },
  { path: "investments.listHoldingPeriods" },
  { path: "investments.getBuyingMonths" },
  { path: "investments.getCurrentBalances" },
  { path: "sec.getStatus" },
  { path: "demo.listProfiles" },
  { path: "taxBuckets.computeBreakdown" },
];

/** Queries the baseline doesn't call, and why. */
export const SKIPPED: Record<string, string> = {
  "settings.testOidcConnection":
    "external: fetches the OIDC issuer's discovery document",
  "settings.taxDataSync.preview":
    "external: fetches the published tax-data index",
  "sync.getPreview":
    "external: calls YNAB or Actual Budget (part d replays recorded responses through the sync instead)",
  "projection.getMonteCarloProgress":
    "progress of a run in flight, keyed by a random run id; no household figure",
  "version.getById": "needs a saved version; the baseline seeds none",
  "version.getPreview": "needs a saved version; the baseline seeds none",
  "version.restoreDataLoss": "needs a saved version; the baseline seeds none",
  "version.importDataLoss":
    "compares a backup file being imported; the baseline imports none",
  "dataBrowser.listTables":
    "admin table browser: raw PostgreSQL SQL, echoes rows the seeder wrote",
  "dataBrowser.getColumns":
    "admin table browser: raw PostgreSQL SQL, echoes rows the seeder wrote",
  "dataBrowser.getRows":
    "admin table browser: raw PostgreSQL SQL, echoes rows the seeder wrote",
};

/** Queries deleted in v0.10.0 commits 28–31 (the 30/90-day balance
 *  change, the Settings API tab, the profile resolver; the in-app test
 *  runner's router has no query), left out so those commits and this
 *  baseline never touch the same files. */
export const DELETED_IN_V0100: Record<string, string> = {
  "investments.getRecentChanges": "deleted in v0.10.0 commits 28–31",
  "apiDocs.list": "deleted in v0.10.0 commits 28–31",
  "contributionProfile.resolve": "deleted in v0.10.0 commits 28–31",
};

/** A procedure's file name: its path, plus `[variant]`. */
export function procedureName(p: BaselineProcedure): string {
  return p.variant ? `${p.path}[${p.variant}]` : p.path;
}

/** Call a procedure by its dotted path on a caller. */
export async function callProcedure(
  caller: Caller,
  p: BaselineProcedure,
  input: unknown,
): Promise<unknown> {
  let target: unknown = caller;
  for (const segment of p.path.split("."))
    target = (target as Record<string, unknown>)[segment];
  const fn = target as (input?: unknown) => Promise<unknown>;
  return p.input ? fn(input) : fn();
}
