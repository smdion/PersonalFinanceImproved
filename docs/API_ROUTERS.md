# tRPC Router Catalog

> **Auto-generated** by `scripts/gen-api-docs.ts`. Do not edit by hand. Run `npx tsx scripts/gen-api-docs.ts` to regenerate.

**327 procedures across 37 routers.**

Procedure type tags: `protectedProcedure` (any signed-in user), `adminProcedure` (admin role), `<domain>Procedure` (permission-scoped), `publicProcedure` (no auth).

## `analytics`

| Procedure                | Kind     | Auth                 | Description                                                                                                                                                                                           |
| ------------------------ | -------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bulkUpsertHoldings`     | mutation | `portfolioProcedure` | Bulk upsert holdings for one account+snapshot in a single round-trip. Replaces the entire set for that account+snapshot (delete-then-insert in a transaction).                                        |
| `copyHoldingsToSnapshot` | mutation | `portfolioProcedure` | Snapshot-copy: duplicate all holdings from snapshot A to snapshot B. Returns { count: 0 } (not an error) when the source snapshot has no holdings.                                                    |
| `deleteHolding`          | mutation | `portfolioProcedure` | Delete one holding by id.                                                                                                                                                                             |
| `getAccounts`            | query    | `portfolioProcedure` | Get all active performance accounts (used to build the account list on the page).                                                                                                                     |
| `getAssetClasses`        | query    | `portfolioProcedure` | Get all asset class params (for the asset class dropdown).                                                                                                                                            |
| `getGlidePathForAge`     | query    | `portfolioProcedure` | Get glide path allocations for a specific age (for drift computation). Returns an empty array if no glide path is configured.                                                                         |
| `getHoldings`            | query    | `portfolioProcedure` | Get all holdings for a given snapshot (or the latest snapshot that has holdings). Only returns holdings for isActive = true performance_accounts.                                                     |
| `getHoldingsHistory`     | query    | `portfolioProcedure` | Fetch holdings across multiple snapshots for historical allocation/drift charts. Only returns snapshots that actually have ≥1 holding.                                                                |
| `getSnapshotBalances`    | query    | `portfolioProcedure` | Get portfolio account balances for a given snapshot (to compute dollar values from weights).                                                                                                          |
| `getSnapshots`           | query    | `portfolioProcedure` | Get all portfolio snapshots (for the snapshot selector).                                                                                                                                              |
| `hasFmpKey`              | query    | `portfolioProcedure` | Check whether an FMP connection is configured (used to show/hide the Look up button). Returns true if a key exists, false otherwise.                                                                  |
| `lookupTicker`           | query    | `portfolioProcedure` | Distinguishes error types so the UI can show the right message: no_key — FMP connection not configured (suppress "Look up" button on the client) not_found — ticker not found in FMP rate_limit — FMP |

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

| Procedure                            | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ------------------------------------ | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addColumn`                          | mutation | `budgetProcedure`    | Add a new column (budget mode) to the target profile (active if not given).                                                                                                                              |
| `computeActiveSummary`               | query    | `protectedProcedure` | Returns the active budget profile's calculator result for a given column.                                                                                                                                |
| `createItem`                         | mutation | `budgetProcedure`    | Create a new budget item.                                                                                                                                                                                |
| `createProfile`                      | mutation | `budgetProcedure`    | categories. Optionally links every starting column to a Contribution Profile so the new profile's income/take-home math uses that Contribution Profile from the start, instead of defaulting to Live and |
| `deleteItem`                         | mutation | `budgetProcedure`    | Delete a budget item.                                                                                                                                                                                    |
| `deleteProfile`                      | mutation | `budgetProcedure`    | Delete a budget profile (cannot delete the active one).                                                                                                                                                  |
| `duplicateProfile`                   | mutation | `budgetProcedure`    | account) is a live external-write hazard, and a copy is exactly how you'd create one by accident. - Forced: `isActive: false`. Duplicating is not activating. Same `budget` permission gate as createPro |
| `linkContributionAccount`            | mutation | `budgetProcedure`    | Link a budget item to a specific contribution account.                                                                                                                                                   |
| `linkToApi`                          | mutation | `budgetProcedure`    | Link a budget item to a budget API category.                                                                                                                                                             |
| `listApiActuals`                     | query    | `protectedProcedure` | Get API actuals for linked budget items (activity + balance from cached month data).                                                                                                                     |
| `listApiCategories`                  | query    | `protectedProcedure` | Get cached categories from the active (or specified) budget API for the category picker.                                                                                                                 |
| `listContribAccountsForLinking`      | query    | `protectedProcedure` | jobId === null means the contribution comes from take-home pay (IRA, taxable brokerage, etc.). Job-linked contributions (401k, HSA, ESPP) are payroll-deducted and already on the paycheck.              |
| `listProfiles`                       | query    | `protectedProcedure` | allocations and per-mode weighting, so resolving the pay side here too keeps it to one round trip and one computation path. Plan pins are session/browser state, so the caller supplies them; the global |
| `moveItem`                           | mutation | `budgetProcedure`    | Move a budget item to a different category.                                                                                                                                                              |
| `removeColumn`                       | mutation | `budgetProcedure`    | Remove a column (budget mode) from the target profile (active if not given).                                                                                                                             |
| `renameColumn`                       | mutation | `budgetProcedure`    | Rename a column (budget mode).                                                                                                                                                                           |
| `renameProfile`                      | mutation | `budgetProcedure`    | Rename a budget profile.                                                                                                                                                                                 |
| `reorderCategory`                    | mutation | `budgetProcedure`    | block. No-ops at the first/last category boundary.                                                                                                                                                       |
| `reorderItem`                        | mutation | `budgetProcedure`    | category. No-ops at the category's first/last item boundary — moving an item into a different category is the "Move..." dropdown's job (moveItem above), not this.                                       |
| `setActiveProfile`                   | mutation | `budgetProcedure`    | — an error between the deactivate-all and activate-one writes must not be able to leave zero active profiles (every downstream reader of getActiveBudgetProfile silently treats that as "no profile").   |
| `setSyncDirection`                   | mutation | `budgetProcedure`    | Change sync direction on a linked budget item.                                                                                                                                                           |
| `syncBudgetFromApi`                  | mutation | `budgetProcedure`    | Pull budgeted amounts from API for all linked items (API -> Ledgr).                                                                                                                                      |
| `syncBudgetToApi`                    | mutation | `budgetProcedure`    | Push budget amounts to API for all linked items (Ledgr -> API).                                                                                                                                          |
| `unlinkContributionAccount`          | mutation | `budgetProcedure`    | Remove contribution account link from a budget item.                                                                                                                                                     |
| `unlinkFromApi`                      | mutation | `budgetProcedure`    | Remove API link from a budget item.                                                                                                                                                                      |
| `updateCategoryEssential`            | mutation | `budgetProcedure`    | Toggle isEssential for all items in a category.                                                                                                                                                          |
| `updateColumnContributionProfileIds` | mutation | `budgetProcedure`    | Update per-column contribution profile assignments.                                                                                                                                                      |
| `updateColumnMonths`                 | mutation | `budgetProcedure`    | Update column months for weighted budget profiles.                                                                                                                                                       |
| `updateColumnSalaryProfileIds`       | mutation | `budgetProcedure`    | contribution-profile assignments above).                                                                                                                                                                 |
| `updateItemAmount`                   | mutation | `budgetProcedure`    | Update a single amount cell for a budget item.                                                                                                                                                           |
| `updateItemAmounts`                  | mutation | `budgetProcedure`    | Batch update multiple amount cells.                                                                                                                                                                      |
| `updateItemEssential`                | mutation | `budgetProcedure`    | Update a budget item's essential flag.                                                                                                                                                                   |

## `contribution`

| Procedure        | Kind  | Auth                 | Description      |
| ---------------- | ----- | -------------------- | ---------------- |
| `computeSummary` | query | `protectedProcedure` | (no description) |

## `contribution-profiles`

| Procedure                | Kind     | Auth                           | Description                                                                                                                                                                                              |
| ------------------------ | -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compareData`            | query    | `protectedProcedure`           | map, keyed by account id. Deliberately skips what `getById` does per profile — perf-account fuzzy matching and full display-name disambiguation — since those only need to happen once per account row,  |
| `create`                 | mutation | `contributionProfileProcedure` | Create a new contribution profile.                                                                                                                                                                       |
| `delete`                 | mutation | `contributionProfileProcedure` | active-profile setting must always resolve to a real row), when it's the globally-active selection, and when any Plan still pins it — the scenarios FK is `set null`, so without that check deleting wou |
| `getById`                | query    | `protectedProcedure`           | Get a single profile with fully resolved per-account details.                                                                                                                                            |
| `list`                   | query    | `protectedProcedure`           | List all contribution profiles with resolved summary totals.                                                                                                                                             |
| `resolve`                | query    | `protectedProcedure`           | Resolve a profile to aggregate totals — used by the relocation tool and any other consumer that needs salary/contribution/match numbers for a given profile.                                             |
| `setAccountActiveFields` | mutation | `contributionProfileProcedure` | caller needing to fetch/merge the full contributionActiveFields blob itself. Used right after creating a new contribution account (e.g. What-If's "Make real") to give it a real value in whichever prof |
| `update`                 | mutation | `contributionProfileProcedure` | Update an existing contribution profile.                                                                                                                                                                 |

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

| Procedure        | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ---------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeSummary` | query    | `protectedProcedure` | (no description)                                                                                                                                                                                         |
| `update`         | mutation | `adminProcedure`     | Update editable fields on a net_worth_annual row (income/tax + otherLiabilities only).                                                                                                                   |
| `upsertNote`     | mutation | `adminProcedure`     | (no description)                                                                                                                                                                                         |
| `upsertSalary`   | mutation | `adminProcedure`     | field falls back to the SAME live estimate the current-year auto-fill in `computeSummary` shows (active job's compensation under the active Salary Profile) for the current year, or 0 for a past year w |

## `mortgage`

| Procedure              | Kind     | Auth                 | Description      |
| ---------------------- | -------- | -------------------- | ---------------- |
| `computeActiveSummary` | query    | `protectedProcedure` | (no description) |
| `create`               | mutation | `adminProcedure`     | (no description) |
| `create`               | mutation | `adminProcedure`     | (no description) |
| `create`               | mutation | `adminProcedure`     | (no description) |
| `delete`               | mutation | `adminProcedure`     | (no description) |
| `delete`               | mutation | `adminProcedure`     | (no description) |
| `delete`               | mutation | `adminProcedure`     | (no description) |
| `list`                 | query    | `protectedProcedure` | (no description) |
| `list`                 | query    | `protectedProcedure` | (no description) |
| `list`                 | query    | `protectedProcedure` | (no description) |
| `update`               | mutation | `adminProcedure`     | (no description) |
| `update`               | mutation | `adminProcedure`     | (no description) |
| `update`               | mutation | `adminProcedure`     | (no description) |

## `networth`

| Procedure                | Kind     | Auth                 | Description                                                                                                                                                                                       |
| ------------------------ | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeComparison`      | query    | `protectedProcedure` | Compare net worth at two dates. Uses nearest portfolio snapshot for investment values, computes mortgage balance at each date, and uses current values for home/cash/other (noted as limitation). |
| `computeDetailedHistory` | query    | `protectedProcedure` | Used by the spreadsheet view; heavier than listHistory (which feeds charts).                                                                                                                      |
| `computeFIProgress`      | query    | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `computeSummary`         | query    | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `create`                 | mutation | `portfolioProcedure` | Create a new snapshot with all its accounts in a single call.                                                                                                                                     |
| `createAccount`          | mutation | `portfolioProcedure` | Create a new sub-account row in the latest snapshot.                                                                                                                                              |
| `delete`                 | mutation | `portfolioProcedure` | Delete a snapshot (cascades to its accounts).                                                                                                                                                     |
| `getLatest`              | query    | `protectedProcedure` | Get the latest snapshot with its accounts (for pre-filling a new snapshot form).                                                                                                                  |
| `listHistory`            | query    | `protectedProcedure` | (no description)                                                                                                                                                                                  |
| `listSnapshots`          | query    | `protectedProcedure` | Paginated snapshot list with optional date range filter and sorting.                                                                                                                              |
| `listSnapshotTotals`     | query    | `protectedProcedure` | Lightweight snapshot totals for portfolio chart — returns (date, total) pairs.                                                                                                                    |
| `updateAccount`          | mutation | `portfolioProcedure` | Update a single portfolio account row (e.g. change owner, toggle active, set label, change tax type).                                                                                             |

## `paycheck`

| Procedure        | Kind  | Auth                 | Description      |
| ---------------- | ----- | -------------------- | ---------------- |
| `computeSummary` | query | `protectedProcedure` | (no description) |

## `performance`

| Procedure                | Kind     | Auth                   | Description                                                                                                                                                                                              |
| ------------------------ | -------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batchUpdateAccounts`    | mutation | `performanceProcedure` | Batch-update account_performance rows for the current year. Used by the Update Performance form to save all flow fields in one pass. Annual rollups are recomputed automatically by computeSummary on ne |
| `computeSummary`         | query    | `protectedProcedure`   | computeSummary — returns all performance data joined through the master performance_accounts table. Includes: annual rollups, account-level detail, master account list, and current-year status.        |
| `confirmPendingRollover` | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `create`                 | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `createAccount`          | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `createPendingRollover`  | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `delete`                 | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `deleteAccount`          | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `deletePendingRollover`  | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `editPendingRollover`    | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `finalizeYear`           | mutation | `performanceProcedure` | Finalize a year: marks all account_performance and annual_performance rows for that year as finalized, then auto-creates next year's rows for active accounts.                                           |
| `list`                   | query    | `protectedProcedure`   | (no description)                                                                                                                                                                                         |
| `update`                 | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `updateAccount`          | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `updateAnnual`           | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |
| `updateCostBasis`        | mutation | `performanceProcedure` | (no description)                                                                                                                                                                                         |

## `projection/coast-fire`

| Procedure            | Kind  | Auth                 | Description                                                                                                                                                                                              |
| -------------------- | ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeCoastFire`   | query | `protectedProcedure` | ~log₂(retirementAge - currentAge) engine runs. Success criterion: `portfolioDepletionAge === null` AND `sustainableWithdrawal >= projectedExpenses` at the first decumulation year. See `findCoastFireAg |
| `computeCoastFireMC` | query | `protectedProcedure` | If the re-probe also passes, the true earliest age may be lower but we return the search result honestly with a warning. Cost: ~5-6 probes × 1 MC run × 1000 trials ≈ 4-6s wall clock (profiled 2026-04- |

## `projection/monte-carlo`

| Procedure                     | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ----------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeMonteCarloProjection` | query    | `protectedProcedure` | Runs N trials of the contribution engine with randomized return rates sampled from correlated log-normal distributions based on asset class parameters and glide path allocations from the DB. Returns p |
| `updateClampBounds`           | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                                                         |
| `updateGlidePathAllocations`  | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                                                         |
| `updateReturnRateTable`       | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                                                         |

## `projection/presets`

| Procedure                  | Kind     | Auth                 | Description                                               |
| -------------------------- | -------- | -------------------- | --------------------------------------------------------- |
| `createPreset`             | mutation | `scenarioProcedure`  | Create a new user Monte Carlo simulation preset.          |
| `deletePreset`             | mutation | `scenarioProcedure`  | Delete a user Monte Carlo simulation preset.              |
| `listPresets`              | query    | `protectedProcedure` | (no description)                                          |
| `updateInflationOverrides` | mutation | `scenarioProcedure`  | Persist MC stochastic inflation overrides to appSettings. |
| `updatePreset`             | mutation | `scenarioProcedure`  | Update an existing user Monte Carlo simulation preset.    |

## `projection/relocation`

| Procedure                       | Kind  | Auth                 | Description                                                                                                                                                                                              |
| ------------------------------- | ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeRelocationFiProjection` | query | `protectedProcedure` | the earliest year when the user can safely relocate and still retire at their configured retirementAge. Also returns year-by-year projection rows for the comparison table, and — when moveYear is provi |

## `projection/scenarios`

| Procedure           | Kind  | Auth                 | Description                                                                                                                                                                                              |
| ------------------- | ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeProjection` | query | `protectedProcedure` | and per-year sticky-forward overrides. All data (salary, contributions, portfolio, limits, return rates) comes from the same DB sources as the other endpoints — this engine just gives you much more gr |

## `projection/strategy`

| Procedure                   | Kind     | Auth                 | Description                                                                                                                                                               |
| --------------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `analyzeStrategy`           | query    | `protectedProcedure` | Analyze the active strategy — run what-if MC scenarios and return ranked recommendations.                                                                                 |
| `computeStrategyComparison` | query    | `protectedProcedure` | Compare all withdrawal strategies side-by-side. Fetches DB data once, then runs calculateProjection() for each strategy varying only withdrawalStrategy + strategyParams. |
| `updateAssetClassOverrides` | mutation | `scenarioProcedure`  | Persist MC asset class return/volatility overrides to appSettings.                                                                                                        |
| `updateInflationRisk`       | mutation | `scenarioProcedure`  | (no description)                                                                                                                                                          |

## `projection/stress-test`

| Procedure           | Kind  | Auth                 | Description                                                                                                                                                                                              |
| ------------------- | ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeStressTest` | query | `protectedProcedure` | returnRates / inflationRate / salaryGrowthRate / withdrawalRate before calling calculateProjection. Returns summary metrics (nest egg at retirement, sustainable withdrawal, depletion age) so the PlanH |

## `retirement`

| Procedure                   | Kind     | Auth                 | Description      |
| --------------------------- | -------- | -------------------- | ---------------- |
| `clear`                     | mutation | `brokerageProcedure` | (no description) |
| `computeRelocationAnalysis` | query    | `protectedProcedure` | (no description) |
| `create`                    | mutation | `adminProcedure`     | (no description) |
| `create`                    | mutation | `adminProcedure`     | (no description) |
| `create`                    | mutation | `adminProcedure`     | (no description) |
| `delete`                    | mutation | `adminProcedure`     | (no description) |
| `delete`                    | mutation | `adminProcedure`     | (no description) |
| `delete`                    | mutation | `adminProcedure`     | (no description) |
| `delete`                    | mutation | `adminProcedure`     | (no description) |
| `get`                       | query    | `protectedProcedure` | (no description) |
| `list`                      | query    | `protectedProcedure` | (no description) |
| `list`                      | query    | `protectedProcedure` | (no description) |
| `list`                      | query    | `protectedProcedure` | (no description) |
| `list`                      | query    | `protectedProcedure` | (no description) |
| `list`                      | query    | `protectedProcedure` | (no description) |
| `save`                      | mutation | `brokerageProcedure` | (no description) |
| `update`                    | mutation | `adminProcedure`     | (no description) |
| `update`                    | mutation | `adminProcedure`     | (no description) |
| `update`                    | mutation | `adminProcedure`     | (no description) |
| `upsert`                    | mutation | `adminProcedure`     | (no description) |
| `upsert`                    | mutation | `adminProcedure`     | (no description) |

## `salary-profiles`

| Procedure | Kind     | Auth                           | Description                                                                                                                                                                                              |
| --------- | -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`  | mutation | `contributionProfileProcedure` | Create a profile. `salaries` defaults to EMPTY — genuinely no job entries, not copied from any other profile. A new what-if profile must never silently inherit whatever another profile happened to say |
| `delete`  | mutation | `contributionProfileProcedure` | Delete a profile. Blocked when it's the last one left (the active-profile setting must always resolve to a real row), when it's the globally-active selection, and when any Plan still pins it — the sce |
| `getById` | query    | `protectedProcedure`           | One profile plus per-person resolved rows, so the editor can show what this profile actually produces for each job without a second round trip.                                                          |
| `list`    | query    | `protectedProcedure`           | All salary profiles, oldest first. Real rows only.                                                                                                                                                       |
| `update`  | mutation | `contributionProfileProcedure` | (no description)                                                                                                                                                                                         |

## `savings`

| Procedure                   | Kind     | Auth                 | Description                                                                                                                                                                                              |
| --------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `batchUpsert`               | mutation | `savingsProcedure`   | Batch upsert overrides for a single goal (fill-down, change-all-after).                                                                                                                                  |
| `computeSummary`            | query    | `protectedProcedure` | (no description)                                                                                                                                                                                         |
| `convertBudgetItemToGoal`   | mutation | `savingsProcedure`   | Convert a budget item into a savings goal, transferring the API category link.                                                                                                                           |
| `convertGoalToBudgetItem`   | mutation | `savingsProcedure`   | Convert a savings goal into a budget item, transferring the API category link.                                                                                                                           |
| `create`                    | mutation | `savingsProcedure`   | ══ PLANNED TRANSACTIONS ══                                                                                                                                                                               |
| `create`                    | mutation | `savingsProcedure`   | ══ TRANSFERS (paired planned transactions) ══                                                                                                                                                            |
| `create`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `delete`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `deleteMonth`               | mutation | `savingsProcedure`   | Delete all overrides for ALL goals in one or more months.                                                                                                                                                |
| `getMonthlyHistory`         | query    | `protectedProcedure` | All recorded monthly balances for active savings goals (for history view).                                                                                                                               |
| `getSettlementSuggestions`  | query    | `protectedProcedure` | this deliberately doesn't try to match dollar amounts: once ANY real transaction posts in the goal's linked category on/after the planned date, in the same month, the live balance already reflects it  |
| `linkGoalToApi`             | mutation | `savingsProcedure`   | Link a savings goal to a budget API category.                                                                                                                                                            |
| `linkReimbursementCategory` | mutation | `savingsProcedure`   | Link a reimbursement tracking category to the e-fund goal.                                                                                                                                               |
| `list`                      | query    | `protectedProcedure` | Every active goal's funding for a given profile.                                                                                                                                                         |
| `list`                      | query    | `protectedProcedure` | Load routing rules for all jobs.                                                                                                                                                                         |
| `list`                      | query    | `protectedProcedure` | (no description)                                                                                                                                                                                         |
| `listApiBalances`           | query    | `protectedProcedure` | Get API category balances for linked savings goals (for display).                                                                                                                                        |
| `listEfundReimbursements`   | query    | `protectedProcedure` | Get parsed reimbursement items from the linked YNAB category's note field.                                                                                                                               |
| `listSummaries`             | query    | `protectedProcedure` | nonzero allocation) for every budget profile at once — for the profile-picker sidebar. Routes through the same resolver as `list` above (one call per profile) rather than re-deriving totals independen |
| `lockInAllocationPercent`   | mutation | `savingsProcedure`   | an accurate description of "what % of current income this is" rather than a stale figure computed against a smaller pool. allocation_percent is decimal(6,3) — rounded to 3 decimals, which at typical p |
| `pushContributionsToApi`    | mutation | `savingsProcedure`   | - Emergency fund: pushes computed targetAmount (targetMonths × essentials) via updateCategoryTargetBalance — amount only, never touches the goal's type/cadence (that has to be configured once, manuall |
| `recalculateAllocation`     | mutation | `savingsProcedure`   | explicitly asks for it here. Omitting goalId recalculates every active percentage-based goal (for the target profile) from one shared live-pool snapshot (a single fetch applied to all rows, so a batch |
| `rematerialize`             | mutation | `savingsProcedure`   | Re-run materializer without changing rules (e.g. after goal rename).                                                                                                                                     |
| `resetAllToZero`            | mutation | `savingsProcedure`   | Set every active goal's funding to $0/no-percent for one profile.                                                                                                                                        |
| `save`                      | mutation | `savingsProcedure`   | Save routing rules for a single job and re-materialize. Preserves existing overrides and growth settings.                                                                                                |
| `saveGrowth`                | mutation | `savingsProcedure`   | Persist growth rates for a job, then re-materialize. Net pay is always recomputed server-side.                                                                                                           |
| `saveOverride`              | mutation | `savingsProcedure`   | Upsert or delete a one-time override for a specific extra-paycheck month.                                                                                                                                |
| `settle`                    | mutation | `savingsProcedure`   | Settlement is per-occurrence (plannedTxId + occurrenceMonth), never per-row — a recurring row has many future occurrences, and settling one must not hide the others from the projection. Never invoked  |
| `settleMany`                | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `unlinkGoalFromApi`         | mutation | `savingsProcedure`   | Unlink a savings goal from a budget API category.                                                                                                                                                        |
| `unsettle`                  | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `update`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `update`                    | mutation | `savingsProcedure`   | (no description)                                                                                                                                                                                         |
| `upsert`                    | mutation | `savingsProcedure`   | ══ ALLOCATION OVERRIDES ══                                                                                                                                                                               |
| `upsert`                    | mutation | `savingsProcedure`   | of the live pool (contrast with recalculateAllocation/ lockInAllocationPercent, which also write here but derive the value from the live pool instead of taking it directly from the caller).            |
| `upsertMonth`               | mutation | `savingsProcedure`   | Atomically upsert overrides for ALL goals in a single month (pool-constrained).                                                                                                                          |
| `upsertMonthRange`          | mutation | `savingsProcedure`   | Atomically upsert overrides for ALL goals across a month range (fill-forward).                                                                                                                           |

## `settings/admin`

| Procedure                       | Kind     | Auth                 | Description                                                                                  |
| ------------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `backfillPerformanceAccountIds` | mutation | `adminProcedure`     | ══ BACKFILL PERFORMANCE ACCOUNT IDS ══                                                       |
| `clearOverride`                 | mutation | `scenarioProcedure`  | Remove a single override from a scenario                                                     |
| `create`                        | mutation | `scenarioProcedure`  | ══ SCENARIOS (global what-if system) ══                                                      |
| `delete`                        | mutation | `adminProcedure`     | Invalidate year-end cache when settings change (e.g. salary averaging toggle)                |
| `delete`                        | mutation | `scenarioProcedure`  | (no description)                                                                             |
| `delete`                        | mutation | `adminProcedure`     | (no description)                                                                             |
| `delete`                        | mutation | `adminProcedure`     | (no description)                                                                             |
| `get`                           | query    | `adminProcedure`     | Get current RBAC group mapping (DB overrides merged with defaults).                          |
| `getDataFreshness`              | query    | `protectedProcedure` | ══ DATA FRESHNESS ══                                                                         |
| `list`                          | query    | `protectedProcedure` | ══ APP SETTINGS ══                                                                           |
| `list`                          | query    | `protectedProcedure` | ══ SCENARIOS (global what-if system) ══                                                      |
| `list`                          | query    | `protectedProcedure` | ══ API CONNECTIONS ══                                                                        |
| `list`                          | query    | `protectedProcedure` | ══ RELOCATION SCENARIOS ══                                                                   |
| `save`                          | mutation | `adminProcedure`     | (no description)                                                                             |
| `setBudgetProfilePin`           | mutation | `scenarioProcedure`  | Pin (or clear, with null) which Budget Profile is "active" when this Plan is selected.       |
| `setContributionProfilePin`     | mutation | `scenarioProcedure`  | Pin (or clear, with null) which Contribution Profile is "active" when this Plan is selected. |
| `setOverride`                   | mutation | `scenarioProcedure`  | Update a single override within a scenario's overrides JSONB                                 |
| `setSalaryProfilePin`           | mutation | `scenarioProcedure`  | Pin (or clear, with null) which Salary Profile is "active" when this Plan is selected.       |
| `update`                        | mutation | `scenarioProcedure`  | (no description)                                                                             |
| `updateDataFreshness`           | mutation | `adminProcedure`     | (no description)                                                                             |
| `upsert`                        | mutation | `adminProcedure`     | (no description)                                                                             |
| `upsert`                        | mutation | `adminProcedure`     | (no description)                                                                             |

## `settings/onboarding`

| Procedure              | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ---------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `completeOnboarding`   | mutation | `adminProcedure`     | (no description)                                                                                                                                                                                         |
| `createLocalAdmin`     | mutation | `publicProcedure`    | never creates a local_admins row, so table-emptiness alone would leave this endpoint permanently open. Runs inside a transaction so the check-then-insert can't race two concurrent first-run requests i |
| `isOnboardingComplete` | query    | `protectedProcedure` | (no description)                                                                                                                                                                                         |
| `testOidcConnection`   | query    | `publicProcedure`    | Test whether OIDC (Authentik) is configured and reachable. Checks env vars and fetches the issuer's well-known endpoint.                                                                                 |

## `settings/paycheck`

| Procedure            | Kind     | Auth                 | Description                    |
| -------------------- | -------- | -------------------- | ------------------------------ |
| `create`             | mutation | `adminProcedure`     | (no description)               |
| `create`             | mutation | `adminProcedure`     | (no description)               |
| `create`             | mutation | `adminProcedure`     | (no description)               |
| `create`             | mutation | `adminProcedure`     | (no description)               |
| `delete`             | mutation | `adminProcedure`     | (no description)               |
| `delete`             | mutation | `adminProcedure`     | (no description)               |
| `delete`             | mutation | `adminProcedure`     | (no description)               |
| `delete`             | mutation | `adminProcedure`     | (no description)               |
| `list`               | query    | `protectedProcedure` | (no description)               |
| `list`               | query    | `protectedProcedure` | (no description)               |
| `list`               | query    | `protectedProcedure` | (no description)               |
| `list`               | query    | `protectedProcedure` | (no description)               |
| `setPriorYearAmount` | mutation | `adminProcedure`     | (no description)               |
| `update`             | mutation | `adminProcedure`     | routing rules has no need for. |
| `update`             | mutation | `adminProcedure`     | (no description)               |
| `update`             | mutation | `adminProcedure`     | (no description)               |
| `update`             | mutation | `adminProcedure`     | (no description)               |

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

## `simplefin`

| Procedure               | Kind     | Auth                 | Description                                                                                                                                                                                             |
| ----------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getStatus`             | query    | `protectedProcedure` | Connection status for the Settings integrations card and the sidebar's Data Updated tooltip.                                                                                                            |
| `listAccounts`          | query    | `protectedProcedure` | matched-group level: every SimpleFIN account linked to a given performance account shares the same `change`, comparing their _combined_ live balance against that one snapshot balance. A per-row delta |
| `listBalanceHistory`    | query    | `protectedProcedure` | Snapshot history for the dashboard sparkline.                                                                                                                                                           |
| `listMatchableAccounts` | query    | `protectedProcedure` | Active performance_accounts, for the match-to-existing-account picker.                                                                                                                                  |
| `removeConnection`      | mutation | `syncProcedure`      | Remove the stored connection (history in simplefin_balance_snapshots is preserved).                                                                                                                     |
| `saveToken`             | mutation | `syncProcedure`      | Claim a one-time setup token and store the resulting access URL.                                                                                                                                        |
| `setAccountIncluded`    | mutation | `syncProcedure`      | Toggle an account's inclusion and recompute today's total from local data immediately — no SimpleFIN API call, so this is free to click repeatedly. Does not touch any prior day's snapshot.            |
| `setAccountMapping`     | mutation | `syncProcedure`      | multiple SimpleFIN accounts can point at the same performance account (e.g. historical account splits/merges Ledgr still tracks as a single account) — listAccounts sums every linked account's balance |
| `syncNow`               | mutation | `syncProcedure`      | Manual sync trigger — calls the same runSimplefinSync the daily cron calls.                                                                                                                             |
| `testConnection`        | mutation | `syncProcedure`      | Test the stored connection without writing a snapshot.                                                                                                                                                  |

## `sync/config`

| Procedure            | Kind     | Auth                 | Description                                                          |
| -------------------- | -------- | -------------------- | -------------------------------------------------------------------- |
| `getActiveBudgetApi` | query    | `protectedProcedure` | Get the current active_budget_api setting                            |
| `setActiveBudgetApi` | mutation | `syncProcedure`      | Set the active_budget_api setting                                    |
| `setLinkedColumn`    | mutation | `syncProcedure`      | Set which budget column (mode) syncs with the budget API.            |
| `setLinkedProfile`   | mutation | `syncProcedure`      | Set (or clear) which Ledgr budget profile syncs with the budget API. |
| `skipCategory`       | mutation | `syncProcedure`      | Skip an API category — hide from "not in Ledgr" list                 |
| `unskipCategory`     | mutation | `syncProcedure`      | Unskip an API category — restore to "not in Ledgr" list              |

## `sync/connections`

| Procedure          | Kind     | Auth                 | Description                                                          |
| ------------------ | -------- | -------------------- | -------------------------------------------------------------------- |
| `deleteConnection` | mutation | `syncProcedure`      | Delete a connection and clear its cache                              |
| `fetchYnabBudgets` | mutation | `syncProcedure`      | Fetch YNAB budgets list using a raw token (before saving connection) |
| `getConnection`    | query    | `protectedProcedure` | Get connection status for each service (not just the active one)     |
| `getSyncStatus`    | query    | `protectedProcedure` | Get sync status for the active API                                   |
| `saveConnection`   | mutation | `syncProcedure`      | Save (upsert) a budget API connection                                |
| `testConnection`   | mutation | `syncProcedure`      | Test a specific service connection (works before activation)         |

## `sync/core`

| Procedure                  | Kind     | Auth                 | Description                                                                                                                                                    |
| -------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeExpenseComparison` | query    | `protectedProcedure` | Compare expenses between two periods using cached transaction data.                                                                                            |
| `getPreview`               | query    | `protectedProcedure` | Preview: read cached data for a service and compare against current manual values. Works before activation — shows what will change when the API is activated. |
| `syncAll`                  | mutation | `syncProcedure`      | Full sync for a specific service — works independently of active_budget_api. Pulls accounts, categories, current month, and transactions into cache.           |

## `sync/mappings`

| Procedure                     | Kind     | Auth                 | Description                                                                                                                                                                                              |
| ----------------------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createAssetAndMap`           | mutation | `syncProcedure`      | Create a new Ledgr asset item and add a mapping to a tracking account.                                                                                                                                   |
| `listAccountMappings`         | query    | `protectedProcedure` | Get account mappings for a service.                                                                                                                                                                      |
| `migrateAccountMappingsToIds` | mutation | `syncProcedure`      | One-time migration: backfill `localId` on account mappings that only have `localName`. For each mapping without `localId`: - mortgage: pattern already uses "mortgage:{id}:{type}" in localName → copy t |
| `pullAssetsFromApi`           | mutation | `syncProcedure`      | Pull tracking account balances from budget API into Ledgr asset values.                                                                                                                                  |
| `pullPortfolioFromApi`        | mutation | `syncProcedure`      | Pull portfolio balances from budget API tracking accounts into the latest snapshot.                                                                                                                      |
| `pushPortfolioToApi`          | mutation | `syncProcedure`      | Push portfolio snapshot balances to budget API tracking accounts.                                                                                                                                        |
| `resyncSnapshot`              | mutation | `syncProcedure`      | fresh tagged transactions. Resyncing a non-latest snapshot causes historical drift (later snapshot deltas were computed against the old state). Pass `confirmNonLatest` after warning the user.          |
| `updateAccountMappings`       | mutation | `syncProcedure`      | Update account mappings for a service (works pre-activation).                                                                                                                                            |

## `sync/names`

| Procedure                  | Kind     | Auth            | Description                                                                                   |
| -------------------------- | -------- | --------------- | --------------------------------------------------------------------------------------------- |
| `moveBudgetItemToApiGroup` | mutation | `syncProcedure` | Move a budget item to the API's category group.                                               |
| `renameBudgetItemApiName`  | mutation | `syncProcedure` | Rename a budget item's API category name to match the Ledgr subcategory (update stored name). |
| `renameBudgetItemToApi`    | mutation | `syncProcedure` | Rename a budget item's subcategory to match the API category name.                            |
| `renameSavingsGoalApiName` | mutation | `syncProcedure` | Update a savings goal's stored API name to match its current Ledgr name.                      |
| `renameSavingsGoalToApi`   | mutation | `syncProcedure` | Rename a savings goal to match the API category name.                                         |
| `syncAllNames`             | mutation | `syncProcedure` | Batch rename all drifted items in one direction.                                              |

## `testing`

| Procedure  | Kind     | Auth             | Description      |
| ---------- | -------- | ---------------- | ---------------- |
| `runTests` | mutation | `adminProcedure` | (no description) |

## `utilities`

| Procedure        | Kind     | Auth                 | Description                                                                                                                                                                      |
| ---------------- | -------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `computeSummary` | query    | `protectedProcedure` | Full per-service, per-year summary. Loads the stored readings and computes every derived value (total/avg/min/max cost & usage, $/unit, YoY) here. Nothing derived is persisted. |
| `deleteReading`  | mutation | `adminProcedure`     | (no description)                                                                                                                                                                 |
| `listServices`   | query    | `protectedProcedure` | All utility services ordered for display.                                                                                                                                        |
| `updateReading`  | mutation | `adminProcedure`     | Update a reading's values by id (key fields stay fixed).                                                                                                                         |
| `updateService`  | mutation | `adminProcedure`     | Update editable fields of an existing service by id (kind is immutable).                                                                                                         |
| `upsertReading`  | mutation | `adminProcedure`     | Create or update a reading by its natural key (serviceId, year, month).                                                                                                          |
| `upsertService`  | mutation | `adminProcedure`     | Create or update a service by its kind (unique).                                                                                                                                 |

## `version`

| Procedure              | Kind     | Auth                 | Description                                                                                                              |
| ---------------------- | -------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `create`               | mutation | `versionProcedure`   | Create a new manual version.                                                                                             |
| `delete`               | mutation | `versionProcedure`   | Delete a version.                                                                                                        |
| `dismissUpgradeBanner` | mutation | `versionProcedure`   | Dismiss the upgrade banner by removing the app_settings flag.                                                            |
| `getById`              | query    | `protectedProcedure` | Get a single version with per-table row counts (no JSONB data).                                                          |
| `getPreview`           | query    | `protectedProcedure` | Preview first 50 rows of a specific table from a version.                                                                |
| `getRetention`         | query    | `protectedProcedure` | Read retention setting.                                                                                                  |
| `getSchedule`          | query    | `protectedProcedure` | Read auto-version schedule setting.                                                                                      |
| `getUpgradeBanner`     | query    | `protectedProcedure` | Check if a pre-upgrade backup banner should be shown.                                                                    |
| `list`                 | query    | `protectedProcedure` | List all versions (metadata only, no JSONB data).                                                                        |
| `resetAllData`         | mutation | `adminProcedure`     | Reset all user data — truncates every table except state_versions, state_version_tables, app_settings, and local_admins. |
| `restore`              | mutation | `versionProcedure`   | Restore from a version.                                                                                                  |
| `setRetention`         | mutation | `versionProcedure`   | Update retention setting and trigger cleanup.                                                                            |
| `setSchedule`          | mutation | `versionProcedure`   | Update auto-version schedule.                                                                                            |
