// Drizzle schema — all table definitions for ledgr.
// This file is the single source of truth for the data model.
// See Migration Plan Section 4 for design principles and seed data notes.
//
// The tables live in ./pg/ by domain (section numbers below); this file
// re-exports them all, so every import of "@/lib/db/schema-pg" is unchanged.
// schema-sqlite.ts (and ./sqlite/) are generated from ./pg/ by
// `npx tsx scripts/gen-sqlite-schema.ts`.

// ============================================================================
// TABLE OF CONTENTS — sections below are in this order:
//
//   1.  People & Jobs .............. people, jobs
//   2.  Contributions & Paycheck ... contributionAccounts, contributionLimits,
//                                    paycheckDeductions
//   3.  Budget ..................... budgetProfiles, budgetItems
//   4.  Savings (sinking funds) .... savingsGoals, savingsMonthly,
//                                    savingsPlannedTransactions,
//                                    savingsAllocationOverrides,
//                                    savingsGoalProfileAllocations
//   5.  Brokerage goals ............ brokerageGoals, brokeragePlannedTransactions
//   6.  Self loans ................. selfLoans
//   7.  Portfolio performance ...... performanceAccounts, portfolioSnapshots,
//                                    portfolioAccounts, annualPerformance,
//                                    accountPerformance
//   8.  Net worth (annual) ......... netWorthAnnual, homeImprovementItems,
//                                    otherAssetItems, historicalNotes
//   9.  Mortgages .................. mortgageLoans, mortgageWhatIfScenarios,
//                                    mortgageExtraPayments, propertyTaxes,
//                                    utilityService, utilityReading, debts
//  10.  Retirement settings ........ retirementSettings, retirementSalaryOverrides,
//                                    retirementBudgetOverrides, projectionOverrides,
//                                    retirementScenarios
//  11.  Return rates & tax tables .. returnRateTable, taxBrackets, ltcgBrackets,
//                                    irmaaBrackets
//  12.  API sync .................. apiConnections, budgetApiCache,
//                                    simplefinBalanceSnapshots, simplefinAccounts
//  13.  App config / admin ......... appSettings, localAdmins
//  14.  Scenarios (relocation) ..... relocationScenarios, scenarios
//  15.  Monte Carlo ................ assetClassParams, assetClassCorrelations,
//                                    glidePathAllocations, mcPresets,
//                                    mcPresetGlidePaths, mcPresetReturnOverrides,
//                                    mcUserPresets
//  16.  Contribution profiles ...... contributionProfiles, salaryProfiles
//  17.  State versions (backup) .... stateVersions, stateVersionTables, changeLog
//
// NOTE: this file is the source of truth. `schema-sqlite.ts` is auto-generated
// via `npx tsx scripts/gen-sqlite-schema.ts` (a regex transform of each
// ./pg/ file). Keep sections in the order above.
// ============================================================================

export * from "./pg/shared";
export * from "./pg/people";
export * from "./pg/contributions";
export * from "./pg/budget";
export * from "./pg/savings";
export * from "./pg/brokerage";
export * from "./pg/self-loans";
export * from "./pg/performance";
export * from "./pg/net-worth";
export * from "./pg/mortgages";
export * from "./pg/retirement";
export * from "./pg/tax-tables";
export * from "./pg/api-sync";
export * from "./pg/app-config";
export * from "./pg/scenarios";
export * from "./pg/monte-carlo";
export * from "./pg/contribution-profiles";
export * from "./pg/state-versions";
