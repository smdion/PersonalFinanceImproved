// Dialect-aware schema re-export.
// TypeScript always sees PG types (the canonical types).
// At runtime, the correct dialect's table objects are used.
//
// PG schema: ./schema-pg.ts   (source of truth)
// SQLite:    ./schema-sqlite.ts (auto-generated via scripts/gen-sqlite-schema.ts)

import { isPostgres } from "./dialect";
import * as pg from "./schema-pg";

// Types are dialect-independent — always from PG schema
export type { TaxBracketEntry, ApiConfig, AccountMapping, RelocationScenarioParams, ScenarioOverrides } from "./schema-pg";

// At runtime, load the active dialect's schema.
// The `as typeof pg` cast is safe because both schemas export identical
// table/column names — only the underlying Drizzle dialect differs.
type Schema = typeof pg;
/* eslint-disable @typescript-eslint/no-require-imports */
const active: Schema = isPostgres()
  ? pg
  : (require("./schema-sqlite") as Schema);
/* eslint-enable @typescript-eslint/no-require-imports */

// --- Re-export all tables from the active schema ---

export const people = active.people;
export const jobs = active.jobs;
export const salaryChanges = active.salaryChanges;
export const contributionAccounts = active.contributionAccounts;
export const contributionLimits = active.contributionLimits;
export const paycheckDeductions = active.paycheckDeductions;
export const budgetProfiles = active.budgetProfiles;
export const budgetItems = active.budgetItems;
export const savingsGoals = active.savingsGoals;
export const savingsMonthly = active.savingsMonthly;
export const savingsPlannedTransactions = active.savingsPlannedTransactions;
export const savingsAllocationOverrides = active.savingsAllocationOverrides;
export const brokerageGoals = active.brokerageGoals;
export const brokeragePlannedTransactions = active.brokeragePlannedTransactions;
export const selfLoans = active.selfLoans;
export const performanceAccounts = active.performanceAccounts;
export const portfolioSnapshots = active.portfolioSnapshots;
export const portfolioAccounts = active.portfolioAccounts;
export const annualPerformance = active.annualPerformance;
export const accountPerformance = active.accountPerformance;
export const netWorthAnnual = active.netWorthAnnual;
export const homeImprovementItems = active.homeImprovementItems;
export const otherAssetItems = active.otherAssetItems;
export const historicalNotes = active.historicalNotes;
export const mortgageLoans = active.mortgageLoans;
export const mortgageWhatIfScenarios = active.mortgageWhatIfScenarios;
export const mortgageExtraPayments = active.mortgageExtraPayments;
export const propertyTaxes = active.propertyTaxes;
export const retirementSettings = active.retirementSettings;
export const retirementSalaryOverrides = active.retirementSalaryOverrides;
export const retirementBudgetOverrides = active.retirementBudgetOverrides;
export const retirementScenarios = active.retirementScenarios;
export const returnRateTable = active.returnRateTable;
export const taxBrackets = active.taxBrackets;
export const apiConnections = active.apiConnections;
export const budgetApiCache = active.budgetApiCache;
export const appSettings = active.appSettings;
export const localAdmins = active.localAdmins;
export const relocationScenarios = active.relocationScenarios;
export const scenarios = active.scenarios;
export const assetClassParams = active.assetClassParams;
export const assetClassCorrelations = active.assetClassCorrelations;
export const glidePathAllocations = active.glidePathAllocations;
export const mcPresets = active.mcPresets;
export const mcPresetGlidePaths = active.mcPresetGlidePaths;
export const mcPresetReturnOverrides = active.mcPresetReturnOverrides;
export const contributionProfiles = active.contributionProfiles;
export const stateVersions = active.stateVersions;
export const stateVersionTables = active.stateVersionTables;
export const changeLog = active.changeLog;
