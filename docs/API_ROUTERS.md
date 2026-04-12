# tRPC Router Catalog

> **Auto-generated** by `scripts/gen-api-docs.ts`. Do not edit by hand. Run `npx tsx scripts/gen-api-docs.ts` to regenerate.

**260 procedures across 28 routers.**

Procedure type tags: `protectedProcedure` (any signed-in user), `adminProcedure` (admin role), `<domain>Procedure` (permission-scoped), `publicProcedure` (no auth).

## `api-docs`

| Procedure | Kind  | Auth             | Description      |
| --------- | ----- | ---------------- | ---------------- |
| `list`    | query | `adminProcedure` | (no description) |

## `assets`

| Procedure               | Kind     | Auth                 | Description                                                                                                                      |
| ----------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `addHomeImprovement`    | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `computeSummary`        | query    | `protectedProcedure` | Asset-focused summary: current state + year-over-year history. Includes API sync status per item so the UI can show sync badges. |
| `deleteHomeImprovement` | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `deleteOtherAsset`      | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `deletePropertyTax`     | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `listPropertyTaxes`     | query    | `protectedProcedure` | (no description)                                                                                                                 |
| `updateAsset`           | mutation | `adminProcedure`     | Update simple asset fields (cash, houseValue) on a net_worth_annual row.                                                         |
| `updateHomeImprovement` | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `upsertNote`            | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `upsertOtherAsset`      | mutation | `adminProcedure`     | (no description)                                                                                                                 |
| `upsertPropertyTax`     | mutation | `adminProcedure`     | (no description)                                                                                                                 |

## `brokerage`

| Procedure        | Kind     | Auth                 | Description      |
| ---------------- | -------- | -------------------- | ---------------- |
| `computeSummary` | query    | `protectedProcedure` | (no description) |
| `createGoal`     | mutation | `brokerageProcedure` | (no description) |
| `deleteGoal`     | mutation | `brokerageProcedure` | (no description) |
| `listGoals`      | query    | `protectedProcedure` | (no description) |
| `updateGoal`     | mutation | `brokerageProcedure` | (no description) |

## `budget`

| Procedure                            | Kind     | Auth                 | Description                                                                                                                                                                                 |
| ------------------------------------ | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addColumn`                          | mutation | `budgetProcedure`    | Add a new column (budget mode) to the active profile.                                                                                                                                       |
| `computeActiveSummary`               | query    | `protectedProcedure` | Returns the active budget profile's calculator result for a given column.                                                                                                                   |
| `createItem`                         | mutation | `budgetProcedure`    | Create a new budget item.                                                                                                                                                                   |
| `createProfile`                      | mutation | `budgetProcedure`    | Create a new budget profile, pre-populated with standard template categories.                                                                                                               |
| `deleteItem`                         | mutation | `budgetProcedure`    | Delete a budget item.                                                                                                                                                                       |
| `deleteProfile`                      | mutation | `budgetProcedure`    | Delete a budget profile (cannot delete the active one).                                                                                                                                     |
| `linkContributionAccount`            | mutation | `budgetProcedure`    | Link a budget item to a specific contribution account.                                                                                                                                      |
| `linkToApi`                          | mutation | `budgetProcedure`    | Link a budget item to a budget API category.                                                                                                                                                |
| `listApiActuals`                     | query    | `protectedProcedure` | Get API actuals for linked budget items (activity + balance from cached month data).                                                                                                        |
| `listApiCategories`                  | query    | `protectedProcedure` | Get cached categories from the active (or specified) budget API for the category picker.                                                                                                    |
| `listContribAccountsForLinking`      | query    | `protectedProcedure` | jobId === null means the contribution comes from take-home pay (IRA, taxable brokerage, etc.). Job-linked contributions (401k, HSA, ESPP) are payroll-deducted and already on the paycheck. |
| `listProfiles`                       | query    | `protectedProcedure` | List all budget profiles with summary totals (for profile sidebar).                                                                                                                         |
| `moveItem`                           | mutation | `budgetProcedure`    | Move a budget item to a different category.                                                                                                                                                 |
| `removeColumn`                       | mutation | `budgetProcedure`    | Remove a column (budget mode) from the active profile.                                                                                                                                      |
| `renameColumn`                       | mutation | `budgetProcedure`    | Rename a column (budget mode).                                                                                                                                                              |
| `renameProfile`                      | mutation | `budgetProcedure`    | Rename a budget profile.                                                                                                                                                                    |
| `setActiveProfile`                   | mutation | `budgetProcedure`    | Set a profile as the active one (deactivate all others).                                                                                                                                    |
| `setSyncDirection`                   | mutation | `budgetProcedure`    | Change sync direction on a linked budget item.                                                                                                                                              |
| `syncBudgetFromApi`                  | mutation | `budgetProcedure`    | Pull budgeted amounts from API for all linked items (API -> Ledgr).                                                                                                                         |
| `syncBudgetToApi`                    | mutation | `budgetProcedure`    | Push budget amounts to API for all linked items (Ledgr -> API).                                                                                                                             |
| `unlinkContributionAccount`          | mutation | `budgetProcedure`    | Remove contribution account link from a budget item.                                                                                                                                        |
| `unlinkFromApi`                      | mutation | `budgetProcedure`    | Remove API link from a budget item.                                                                                                                                                         |
| `updateCategoryEssential`            | mutation | `budgetProcedure`    | Toggle isEssential for all items in a category.                                                                                                                                             |
| `updateColumnContributionProfileIds` | mutation | `budgetProcedure`    | Update per-column contribution profile assignments.                                                                                                                                         |
| `updateColumnMonths`                 | mutation | `budgetProcedure`    | Update column months for weighted budget profiles.                                                                                                                                          |
| `updateItemAmount`                   | mutation | `budgetProcedure`    | Update a single amount cell for a budget item.                                                                                                                                              |
| `updateItemAmounts`                  | mutation | `budgetProcedure`    | Batch update multiple amount cells.                                                                                                                                                         |
| `updateItemEssential`                | mutation | `budgetProcedure`    | Update a budget item's essential flag.                                                                                                                                                      |

## `contribution`

| Procedure        | Kind  | Auth                 | Description      |
| ---------------- | ----- | -------------------- | ---------------- |
| `computeSummary` | query | `protectedProcedure` | (no description) |

## `contribution-profiles`

| Procedure | Kind     | Auth                           | Description                                                                                                                                                  |
| --------- | -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create`  | mutation | `contributionProfileProcedure` | Create a new contribution profile.                                                                                                                           |
| `delete`  | mutation | `contributionProfileProcedure` | Delete a contribution profile (cannot delete default).                                                                                                       |
| `getById` | query    | `protectedProcedure`           | Get a single profile with fully resolved per-account details.                                                                                                |
| `list`    | query    | `protectedProcedure`           | List all contribution profiles with resolved summary totals.                                                                                                 |
| `resolve` | query    | `protectedProcedure`           | Resolve a profile to aggregate totals — used by the relocation tool and any other consumer that needs salary/contribution/match numbers for a given profile. |
| `update`  | mutation | `contributionProfileProcedure` | Update an existing contribution profile.                                                                                                                     |

## `data-browser`

| Procedure     | Kind  | Auth             | Description                            |
| ------------- | ----- | ---------------- | -------------------------------------- |
| `exportTable` | query | `adminProcedure` | Export full table as JSON array.       |
| `getColumns`  | query | `adminProcedure` | Get column metadata for a table.       |
| `getRows`     | query | `adminProcedure` | Get paginated rows from a table.       |
| `listTables`  | query | `adminProcedure` | List all known tables with row counts. |

## `demo`

| Procedure         | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ----------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activateProfile` | mutation | `protectedProcedure` | Uses protectedProcedure (not a domain procedure) intentionally: writes go to an isolated per-user demo schema, never to shared application data, and must remain callable in DEMO_ONLY mode. See RULES.m |
| `deactivateDemo`  | mutation | `protectedProcedure` | Uses protectedProcedure (not a domain procedure) intentionally: this mutates session/cookie state, not application data, and must remain callable in DEMO_ONLY mode where the demoOnlyGuard exempts demo |
| `isDemoReady`     | query    | `protectedProcedure` | Check if a demo schema exists and has data.                                                                                                                                                              |
| `listProfiles`    | query    | `protectedProcedure` | List available demo profiles.                                                                                                                                                                            |

## `historical`

| Procedure        | Kind     | Auth                 | Description                                                                            |
| ---------------- | -------- | -------------------- | -------------------------------------------------------------------------------------- |
| `computeSummary` | query    | `protectedProcedure` | (no description)                                                                       |
| `update`         | mutation | `adminProcedure`     | Update editable fields on a net_worth_annual row (income/tax + otherLiabilities only). |
| `upsertNote`     | mutation | `adminProcedure`     | (no description)                                                                       |

## `mortgage`

| Procedure              | Kind  | Auth                 | Description      |
| ---------------------- | ----- | -------------------- | ---------------- |
| `computeActiveSummary` | query | `protectedProcedure` | (no description) |

## `networth`

| Procedure                | Kind  | Auth                 | Description                                                                                                                                                                                       |
| ------------------------ | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeComparison`      | query | `protectedProcedure` | Compare net worth at two dates. Uses nearest portfolio snapshot for investment values, computes mortgage balance at each date, and uses current values for home/cash/other (noted as limitation). |
| `computeDetailedHistory` | query | `protectedProcedure` | Used by the spreadsheet view; heavier than listHistory (which feeds charts).                                                                                                                      |
| `computeFIProgress`      | query | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `computeSummary`         | query | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `listHistory`            | query | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `listSnapshots`          | query | `protectedProcedure` | Paginated snapshot list with optional date range filter and sorting.                                                                                                                              |
| `listSnapshotTotals`     | query | `protectedProcedure` | Lightweight snapshot totals for portfolio chart — returns (date, total) pairs.                                                                                                                    |

## `paycheck`

| Procedure        | Kind  | Auth                 | Description      |
| ---------------- | ----- | -------------------- | ---------------- |
| `computeSummary` | query | `protectedProcedure` | (no description) |

## `performance`

| Procedure             | Kind     | Auth                   | Description                                                                                                                                                                                              |
| --------------------- | -------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batchUpdateAccounts` | mutation | `performanceProcedure` | Batch-update account_performance rows for the current year. Used by the Update Performance form to save all flow fields in one pass. Annual rollups are recomputed automatically by computeSummary on ne |
| `computeSummary`      | query    | `protectedProcedure`   | computeSummary — returns all performance data joined through the master performance_accounts table. Includes: annual rollups, account-level detail, master account list, and current-year status.        |
| `createAccount`       | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `deleteAccount`       | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `finalizeYear`        | mutation | `performanceProcedure` | Finalize a year: marks all account_performance and annual_performance rows for that year as finalized, then auto-creates next year's rows for active accounts.                                           |
| `updateAccount`       | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `updateAnnual`        | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `updateCostBasis`     | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |

## `projection`

| Procedure                    | Kind     | Auth                 | Description                                                                                                                                                               |
| ---------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzeStrategy`            | query    | `protectedProcedure` | Analyze the active strategy — run what-if MC scenarios and return ranked recommendations.                                                                                 |
| `computeStrategyComparison`  | query    | `protectedProcedure` | Compare all withdrawal strategies side-by-side. Fetches DB data once, then runs calculateProjection() for each strategy varying only withdrawalStrategy + strategyParams. |
| `createPreset`               | mutation | `scenarioProcedure`  | Create a new user Monte Carlo simulation preset.                                                                                                                          |
| `deletePreset`               | mutation | `scenarioProcedure`  | Delete a user Monte Carlo simulation preset.                                                                                                                              |
| `listPresets`                | query    | `protectedProcedure` | List all user-created Monte Carlo simulation presets.                                                                                                                     |
| `updateAssetClassOverrides`  | mutation | `scenarioProcedure`  | Persist MC asset class return/volatility overrides to appSettings.                                                                                                        |
| `updateClampBounds`          | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                          |
| `updateGlidePathAllocations` | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                          |
| `updateInflationOverrides`   | mutation | `scenarioProcedure`  | Persist MC stochastic inflation overrides to appSettings.                                                                                                                 |
| `updateInflationRisk`        | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                          |
| `updatePreset`               | mutation | `scenarioProcedure`  | Update an existing user Monte Carlo simulation preset.                                                                                                                    |
| `updateReturnRateTable`      | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                          |

## `savings`

| Procedure                   | Kind     | Auth                 | Description                                                                                                                                                                                    |
| --------------------------- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batchUpsert`               | mutation | `savingsProcedure`   | Batch upsert overrides for a single goal (fill-down, change-all-after).                                                                                                                        |
| `computeSummary`            | query    | `protectedProcedure` | (no description)                                                                                                                                                                               |
| `convertBudgetItemToGoal`   | mutation | `savingsProcedure`   | Convert a budget item into a savings goal, transferring the API category link.                                                                                                                 |
| `convertGoalToBudgetItem`   | mutation | `savingsProcedure`   | Convert a savings goal into a budget item, transferring the API category link.                                                                                                                 |
| `create`                    | mutation | `savingsProcedure`   | ══ PLANNED TRANSACTIONS ══                                                                                                                                                                     |
| `create`                    | mutation | `savingsProcedure`   | ══ TRANSFERS (paired planned transactions) ══                                                                                                                                                  |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                               |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                               |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                               |
| `deleteMonth`               | mutation | `savingsProcedure`   | Delete all overrides for ALL goals in one or more months.                                                                                                                                      |
| `linkGoalToApi`             | mutation | `savingsProcedure`   | Link a savings goal to a budget API category.                                                                                                                                                  |
| `linkReimbursementCategory` | mutation | `savingsProcedure`   | Link a reimbursement tracking category to the e-fund goal.                                                                                                                                     |
| `listApiBalances`           | query    | `protectedProcedure` | Get API category balances for linked savings goals (for display).                                                                                                                              |
| `listEfundReimbursements`   | query    | `protectedProcedure` | Get parsed reimbursement items from the linked YNAB category's note field.                                                                                                                     |
| `pushContributionsToApi`    | mutation | `savingsProcedure`   | Push monthly contributions as budget API goal targets for linked sinking funds. Sets the goal target at the plan/category level (not month-specific). Can optionally push a single goal by ID. |
| `unlinkGoalFromApi`         | mutation | `savingsProcedure`   | Unlink a savings goal from a budget API category.                                                                                                                                              |
| `update`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                               |
| `upsert`                    | mutation | `savingsProcedure`   | ══ ALLOCATION OVERRIDES ══                                                                                                                                                                     |
| `upsertMonth`               | mutation | `savingsProcedure`   | Atomically upsert overrides for ALL goals in a single month (pool-constrained).                                                                                                                |
| `upsertMonthRange`          | mutation | `savingsProcedure`   | Atomically upsert overrides for ALL goals across a month range (fill-forward).                                                                                                                 |

## `settings/admin`

| Procedure                       | Kind     | Auth                   | Description                                                                      |
| ------------------------------- | -------- | ---------------------- | -------------------------------------------------------------------------------- |
| `backfillPerformanceAccountIds` | mutation | `adminProcedure`       | ══ BACKFILL PERFORMANCE ACCOUNT IDS ══                                           |
| `clearOverride`                 | mutation | `scenarioProcedure`    | Remove a single override from a scenario                                         |
| `create`                        | mutation | `scenarioProcedure`    | ══ SCENARIOS (global what-if system) ══                                          |
| `create`                        | mutation | `savingsProcedure`     | (no description)                                                                 |
| `create`                        | mutation | `performanceProcedure` | (no description)                                                                 |
| `create`                        | mutation | `portfolioProcedure`   | Create a new snapshot with all its accounts in a single call.                    |
| `createAccount`                 | mutation | `portfolioProcedure`   | Create a new sub-account row in the latest snapshot.                             |
| `delete`                        | mutation | `adminProcedure`       | Invalidate year-end cache when settings change (e.g. salary averaging toggle)    |
| `delete`                        | mutation | `scenarioProcedure`    | (no description)                                                                 |
| `delete`                        | mutation | `adminProcedure`       | (no description)                                                                 |
| `delete`                        | mutation | `savingsProcedure`     | (no description)                                                                 |
| `delete`                        | mutation | `adminProcedure`       | (no description)                                                                 |
| `delete`                        | mutation | `performanceProcedure` | (no description)                                                                 |
| `delete`                        | mutation | `portfolioProcedure`   | Delete a snapshot (cascades to its accounts).                                    |
| `get`                           | query    | `adminProcedure`       | Get current RBAC group mapping (DB overrides merged with defaults).              |
| `getDataFreshness`              | query    | `protectedProcedure`   | ══ DATA FRESHNESS ══                                                             |
| `getLatest`                     | query    | `protectedProcedure`   | Get the latest snapshot with its accounts (for pre-filling a new snapshot form). |
| `list`                          | query    | `protectedProcedure`   | ══ APP SETTINGS ══                                                               |
| `list`                          | query    | `protectedProcedure`   | ══ SCENARIOS (global what-if system) ══                                          |
| `list`                          | query    | `protectedProcedure`   | ══ API CONNECTIONS ══                                                            |
| `list`                          | query    | `protectedProcedure`   | ══ SAVINGS GOALS ══                                                              |
| `list`                          | query    | `protectedProcedure`   | ══ RELOCATION SCENARIOS ══                                                       |
| `list`                          | query    | `protectedProcedure`   | ══ PERFORMANCE ACCOUNTS (master registry) ══                                     |
| `save`                          | mutation | `adminProcedure`       | (no description)                                                                 |
| `setOverride`                   | mutation | `scenarioProcedure`    | Update a single override within a scenario's overrides JSONB                     |
| `update`                        | mutation | `scenarioProcedure`    | (no description)                                                                 |
| `update`                        | mutation | `savingsProcedure`     | (no description)                                                                 |
| `update`                        | mutation | `performanceProcedure` | (no description)                                                                 |
| `updateAccount`                 | mutation | `portfolioProcedure`   | Update a single portfolio account row (e.g. change owner or toggle active).      |
| `updateDataFreshness`           | mutation | `adminProcedure`       | (no description)                                                                 |
| `upsert`                        | mutation | `adminProcedure`       | (no description)                                                                 |
| `upsert`                        | mutation | `adminProcedure`       | (no description)                                                                 |

## `settings/mortgage`

| Procedure | Kind     | Auth                 | Description      |
| --------- | -------- | -------------------- | ---------------- |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |

## `settings/onboarding`

| Procedure              | Kind     | Auth                 | Description                                                                                                                                                                                      |
| ---------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `completeOnboarding`   | mutation | `adminProcedure`     | (no description)                                                                                                                                                                                 |
| `createLocalAdmin`     | mutation | `publicProcedure`    | Create the initial local admin account during onboarding. Guard: only callable when no local admins exist yet. Uses publicProcedure because no session exists before the first admin is created. |
| `isOnboardingComplete` | query    | `protectedProcedure` | (no description)                                                                                                                                                                                 |
| `testOidcConnection`   | query    | `publicProcedure`    | Test whether OIDC (Authentik) is configured and reachable. Checks env vars and fetches the issuer's well-known endpoint.                                                                         |

## `settings/paycheck`

| Procedure            | Kind     | Auth                 | Description      |
| -------------------- | -------- | -------------------- | ---------------- |
| `create`             | mutation | `adminProcedure`     | (no description) |
| `create`             | mutation | `adminProcedure`     | (no description) |
| `create`             | mutation | `adminProcedure`     | (no description) |
| `create`             | mutation | `adminProcedure`     | (no description) |
| `create`             | mutation | `adminProcedure`     | (no description) |
| `delete`             | mutation | `adminProcedure`     | (no description) |
| `delete`             | mutation | `adminProcedure`     | (no description) |
| `delete`             | mutation | `adminProcedure`     | (no description) |
| `delete`             | mutation | `adminProcedure`     | (no description) |
| `delete`             | mutation | `adminProcedure`     | (no description) |
| `list`               | query    | `protectedProcedure` | (no description) |
| `list`               | query    | `protectedProcedure` | (no description) |
| `list`               | query    | `protectedProcedure` | (no description) |
| `list`               | query    | `protectedProcedure` | (no description) |
| `list`               | query    | `protectedProcedure` | (no description) |
| `setPriorYearAmount` | mutation | `adminProcedure`     | (no description) |
| `update`             | mutation | `adminProcedure`     | (no description) |
| `update`             | mutation | `adminProcedure`     | (no description) |
| `update`             | mutation | `adminProcedure`     | (no description) |
| `update`             | mutation | `adminProcedure`     | (no description) |
| `update`             | mutation | `adminProcedure`     | (no description) |

## `settings/retirement`

| Procedure | Kind     | Auth                 | Description      |
| --------- | -------- | -------------------- | ---------------- |
| `clear`   | mutation | `brokerageProcedure` | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `get`     | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `save`    | mutation | `brokerageProcedure` | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `upsert`  | mutation | `adminProcedure`     | (no description) |
| `upsert`  | mutation | `adminProcedure`     | (no description) |

## `settings/tax-limits`

| Procedure | Kind     | Auth                 | Description      |
| --------- | -------- | -------------------- | ---------------- |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `create`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `delete`  | mutation | `adminProcedure`     | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `list`    | query    | `protectedProcedure` | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |
| `update`  | mutation | `adminProcedure`     | (no description) |

## `sync-config`

| Procedure            | Kind     | Auth                 | Description                                               |
| -------------------- | -------- | -------------------- | --------------------------------------------------------- |
| `getActiveBudgetApi` | query    | `protectedProcedure` | Get the current active_budget_api setting                 |
| `setActiveBudgetApi` | mutation | `adminProcedure`     | Set the active_budget_api setting                         |
| `setLinkedColumn`    | mutation | `adminProcedure`     | Set which budget column (mode) syncs with the budget API. |
| `setLinkedProfile`   | mutation | `adminProcedure`     | Set which Ledgr budget profile syncs with the budget API. |
| `skipCategory`       | mutation | `adminProcedure`     | Skip an API category — hide from "not in Ledgr" list      |
| `unskipCategory`     | mutation | `adminProcedure`     | Unskip an API category — restore to "not in Ledgr" list   |

## `sync-connections`

| Procedure          | Kind     | Auth                 | Description                                                          |
| ------------------ | -------- | -------------------- | -------------------------------------------------------------------- |
| `deleteConnection` | mutation | `adminProcedure`     | Delete a connection and clear its cache                              |
| `fetchYnabBudgets` | mutation | `adminProcedure`     | Fetch YNAB budgets list using a raw token (before saving connection) |
| `getConnection`    | query    | `protectedProcedure` | Get connection status for each service (not just the active one)     |
| `getSyncStatus`    | query    | `protectedProcedure` | Get sync status for the active API                                   |
| `saveConnection`   | mutation | `adminProcedure`     | Save (upsert) a budget API connection                                |
| `testConnection`   | mutation | `adminProcedure`     | Test a specific service connection (works before activation)         |

## `sync-core`

| Procedure                  | Kind     | Auth                 | Description                                                                                                                                                    |
| -------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeExpenseComparison` | query    | `protectedProcedure` | Compare expenses between two periods using cached transaction data.                                                                                            |
| `getPreview`               | query    | `protectedProcedure` | Preview: read cached data for a service and compare against current manual values. Works before activation — shows what will change when the API is activated. |
| `syncAll`                  | mutation | `syncProcedure`      | Full sync for a specific service — works independently of active_budget_api. Pulls accounts, categories, current month, and transactions into cache.           |

## `sync-mappings`

| Procedure                     | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ----------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAssetAndMap`           | mutation | `adminProcedure`     | Create a new Ledgr asset item and add a mapping to a tracking account.                                                                                                                                   |
| `listAccountMappings`         | query    | `protectedProcedure` | Get account mappings for a service.                                                                                                                                                                      |
| `migrateAccountMappingsToIds` | mutation | `adminProcedure`     | One-time migration: backfill `localId` on account mappings that only have `localName`. For each mapping without `localId`: - mortgage: pattern already uses "mortgage:{id}:{type}" in localName → copy t |
| `pullAssetsFromApi`           | mutation | `adminProcedure`     | Pull tracking account balances from budget API into Ledgr asset values.                                                                                                                                  |
| `pullPortfolioFromApi`        | mutation | `adminProcedure`     | Pull portfolio balances from budget API tracking accounts into the latest snapshot.                                                                                                                      |
| `pushPortfolioToApi`          | mutation | `adminProcedure`     | Push portfolio snapshot balances to budget API tracking accounts.                                                                                                                                        |
| `resyncSnapshot`              | mutation | `adminProcedure`     | fresh tagged transactions. Resyncing a non-latest snapshot causes historical drift (later snapshot deltas were computed against the old state). Pass `confirmNonLatest` after warning the user.          |
| `updateAccountMappings`       | mutation | `adminProcedure`     | Update account mappings for a service (works pre-activation).                                                                                                                                            |

## `sync-names`

| Procedure                  | Kind     | Auth             | Description                                                                                   |
| -------------------------- | -------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `moveBudgetItemToApiGroup` | mutation | `adminProcedure` | Move a budget item to the API's category group.                                               |
| `renameBudgetItemApiName`  | mutation | `adminProcedure` | Rename a budget item's API category name to match the Ledgr subcategory (update stored name). |
| `renameBudgetItemToApi`    | mutation | `adminProcedure` | Rename a budget item's subcategory to match the API category name.                            |
| `renameSavingsGoalApiName` | mutation | `adminProcedure` | Update a savings goal's stored API name to match its current Ledgr name.                      |
| `renameSavingsGoalToApi`   | mutation | `adminProcedure` | Rename a savings goal to match the API category name.                                         |
| `syncAllNames`             | mutation | `adminProcedure` | Batch rename all drifted items in one direction.                                              |

## `testing`

| Procedure  | Kind     | Auth             | Description      |
| ---------- | -------- | ---------------- | ---------------- |
| `runTests` | mutation | `adminProcedure` | (no description) |

## `version`

| Procedure              | Kind     | Auth                 | Description                                                                         |
| ---------------------- | -------- | -------------------- | ----------------------------------------------------------------------------------- |
| `create`               | mutation | `versionProcedure`   | Create a new manual version.                                                        |
| `delete`               | mutation | `versionProcedure`   | Delete a version.                                                                   |
| `dismissUpgradeBanner` | mutation | `versionProcedure`   | Dismiss the upgrade banner by removing the app_settings flag.                       |
| `getById`              | query    | `protectedProcedure` | Get a single version with per-table row counts (no JSONB data).                     |
| `getPreview`           | query    | `protectedProcedure` | Preview first 50 rows of a specific table from a version.                           |
| `getRetention`         | query    | `protectedProcedure` | Read retention setting.                                                             |
| `getSchedule`          | query    | `protectedProcedure` | Read auto-version schedule setting.                                                 |
| `getUpgradeBanner`     | query    | `protectedProcedure` | Check if a pre-upgrade backup banner should be shown.                               |
| `list`                 | query    | `protectedProcedure` | List all versions (metadata only, no JSONB data).                                   |
| `resetAllData`         | mutation | `adminProcedure`     | Reset all user data — truncates every table except state_versions and app_settings. |
| `restore`              | mutation | `versionProcedure`   | Restore from a version.                                                             |
| `setRetention`         | mutation | `versionProcedure`   | Update retention setting and trigger cleanup.                                       |
| `setSchedule`          | mutation | `versionProcedure`   | Update auto-version schedule.                                                       |
