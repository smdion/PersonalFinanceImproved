# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.7

## [0.7.6] - 2026-08-20

### Fixed

- **Contribution Profiles: the Method dropdown and the Value field's $/% now agree for an account with no method set yet.** Previously an unset method rendered the dropdown as "% of Salary" (its first option) while the $/% prefix on the Value field was computed from the actual (empty) stored method and showed "$" instead — so a blank row's dropdown and value field visibly disagreed, and the mismatch could also affect what got saved on first entry.
- **The new-profile form now lets you set a Method and Value per account at creation time**, instead of only being settable afterward in the standing profile editor. Leaving Value blank still leaves that account unset, same as before.
- Removed the Employer Match/Match Cap placeholder hints on the new-profile form that showed each account's own live match config — they read as pre-filled defaults rather than examples.

## [0.7.4] - Unreleased

### Changed (internal)

- Bumped `better-sqlite3` from 12.11.1 to 13.0.3.
- Bumped `@testing-library/jest-dom` from 6.9.1 to 7.0.1.
- Bumped `jsdom` from 29.1.1 to 30.0.1.
- Bumped `@tanstack/react-table` from 8.21.3 to 9.1.2.

## [0.7.3] - 2026-08-18

### Changed

- **Salary and bonus history no longer lives on jobs.** The Historical page's Year-End table is now the single, direct record of what you earned each past year — editing a year there writes straight to that year's fact, with no more indirection through a job's dated raise ledger. The in-progress current year still auto-fills from your active Salary Profile until you record the real number.
- **A Salary Profile's entry for a job is now complete or absent — never partial.** A job either has real numbers for salary, bonus %, multiplier, and months-in-bonus-year all together, or the profile says nothing about it and it contributes $0. There's no more "pin one field, the rest quietly falls back to something else" — if you want different numbers, use a different profile. The Salary Profile editor drops the old pin/live/revert-to-live controls entirely in favor of plain add/edit/remove per job.
- **Creating a job no longer asks for a starting salary.** Jobs are now pure employment structure (employer, dates, payroll/withholding config) — pay comes exclusively from the Salary Profile you give that job an entry in. Onboarding's Income step still collects each person's starting pay, but now sets it up as a Salary Profile entry instead of a job field.
- **Adding a Contribution Account is now available directly from the Contribution Profile manager**, alongside the existing profile compare view — no need to leave the page to set one up.
- **One padlock now controls edit-protection everywhere profiles are edited** — the Budget page's four tabs, the standalone Savings page, and the Paycheck page all shared the same underlying data but used to lock independently. Locking or unlocking on any one of them now locks/unlocks all of them.

### Fixed

- **The Paycheck page's salary padlock is now a plain edit-protection toggle** instead of implying a "correct baseline" you could revert to — unlocking it lets you edit a job's entry in the currently-viewed Salary Profile directly, and locking it now also protects the bonus % and multiplier fields alongside salary (previously those stayed editable while locked, silently failing to save).
- **A stored bonus multiplier of exactly 0 is now treated as a real "no bonus this cycle" value**, instead of being silently bumped up to 1x.
- **Finalizing a year on the Performance page no longer records $0 income** if that year's salary hasn't been entered yet — it now falls back to the same estimate the Historical page uses, or asks you to record the year's salary first.
- **Switching Salary Profiles mid-Plan now carries the bonus into retirement projections and contribution calculations**, instead of only the base salary.
- **Toggling "include bonus in contributions" on a Contribution Profile now actually takes effect** instead of silently no-op'ing.
- **A household's expected year-to-date contribution figure now reflects any active What-If salary override**, matching the actual salary figure shown alongside it.
- Fixed a case where the Net Worth page's budget summary could silently use $0 income when no Salary Profile was explicitly selected.
- Deleting a person now cleans up correctly if the delete is interrupted partway through, instead of leaving an orphaned placeholder job behind.
- Creating a new Contribution Profile now enforces the same validation as editing one.
- **Several pages (Savings, Expenses, Net Worth, and two dashboard cards) now correctly reflect a Plan's pinned Salary Profile** in their budget totals, instead of silently falling back to whichever Salary Profile is globally active.
- **Retirement projections, the year-end Net Worth history, and the Budget Profile sidebar's "Unspent" figure now correctly include budget items linked to a Contribution Account**, instead of showing them as $0.
- **Editing an account's employer match or auto-maximize setting from the Portfolio page now updates the active Contribution Profile**, instead of writing to a value the active profile was already overriding elsewhere (which made the edit silently disappear).
- **Locking the Savings allocation editor on the Budget page now also locks it on the standalone Savings page**, so a lock set on one page actually protects the same numbers everywhere they're editable.
- **The Relocation tool's projections now correctly include budget items linked to a Contribution Account, and respect a Plan's pinned Salary Profile**, instead of silently undercounting linked expenses or ignoring the pinned salary — bringing it in line with the Retirement page for the same scenario.

### Changed (internal hardening, no user-facing behavior change for existing data)

- The one-time conversion that moved salary history off jobs and onto the Historical page is now safe to run twice, uses accurate per-year date handling regardless of server timezone, and correctly carries a salary forward through years with no raise recorded.
- Production deploys now take an automatic safety backup immediately before that one-time conversion runs, in addition to the existing pre-upgrade backup.

## [0.7.2] - 2026-08-16

### Added

- **A new "What-If" tab on the Budget page** — a sandboxed area to try a different salary, bonus, deductions, contribution accounts, and budget amounts together, and see the resulting take-home pay, whether it covers your budget, and what's left over for savings — without changing anything your household actually sees. Edits are local until you explicitly keep them: duplicate the budget profile with your changes baked in, save the whole combination as a Plan, or graduate a hand-added deduction or contribution account into a real, permanent one.
- **A job's bonus can now be pinned to its actual paid-out amount for just the current year**, without suppressing the full formula-computed bonus in future-year retirement projections. Previously, overriding a bonus permanently depressed every future projected year, since salary and bonus were compounded together as one blended number.
- **The Household Income dashboard card shows a consistent bonus breakout across all three view modes** (Current Salary, Year-End Estimate, Actual YTD), with the Year-To-Date view distinguishing a bonus that's already been paid from one that's still pending.
- **Budget Profiles support weighted modes with an actual editor.** Give each mode a number of months per year (e.g. 1 month Traveling + 11 months At Home) directly from Manage Modes, with a live "must sum to 12" check — previously the underlying data model supported this but there was no way to set it from the UI.
- **Weighted budget profiles now show a Blended column** in the summary table — a "typical month" figure that blends every mode by its month-weight, so you're not left doing the math yourself to reconcile the top-line annual total against the per-mode rows.
- **The weighted annual total now includes savings**, not just budgeted spending.
- **The Savings Profiles sidebar shows Allocated and Unspent per profile**, so you can see funding status for every profile at a glance instead of only the one you're viewing.
- **A new "Reset all to zero" action on the Savings Profiles tab** clears every goal's funding for a profile in one click.
- **Creating a Budget Profile can link it to a Contribution Profile from the start**, instead of requiring a separate trip to Manage Modes afterward.

### Changed

- **Salary Profiles are now ordinary, renamable, deletable rows** instead of a synthetic "default" placeholder you couldn't otherwise manage — create as many as you want, rename them, remove the ones you don't need.
- **Bonus percentage and multiplier moved from Contribution Profile to Salary Profile**, alongside salary itself — each profile now controls what it conceptually owns, instead of salary living in one profile and its bonus terms in another.
- **Savings goal funding (allocation % / monthly $) is now entirely per budget profile**, with no shared default a profile silently falls back to. Each budget profile is its own funding scenario — a goal with no explicit funding under a given profile now reads as $0 for that profile, instead of quietly inheriting a value from wherever it was last edited. Historical per-year tooltips also no longer misapply a bonus pin to years it wasn't set for.

### Fixed

- **A Salary Profile's pinned bonus percentage/multiplier was silently ignored by actual paycheck and contribution calculations**, even though the profile editor correctly showed it — pinning a salary while leaving bonus terms live (or vice versa) now works everywhere, not just in the preview.
- **The Budget page's item table could stretch a couple of amount columns very wide with lots of empty space** when a budget profile had only 1–2 modes, while the category/item name column stayed too narrow for longer names — column widths now scale with how many modes exist instead of always splitting leftover space evenly.
- **The emergency-fund budget tier could read past the end of a budget profile with fewer columns than whichever profile was active when the tier setting was last saved**, silently pulling essential-expense numbers from a nonexistent tier.

### Added

- **Sinking funds: mark a planned transaction "settled"** once its real spend has actually happened, instead of deleting it. Settled occurrences are excluded from the forward balance projection but stay visible in history — no more choosing between stale placeholder clutter and losing the record. A dismissible banner suggests likely-settled items for YNAB-linked funds (based on real transaction activity showing up in the linked category — never an automatic write, always a one-click confirm), and a direct settle action is available on any planned transaction in both the Transactions tab and each fund's card. Rows planned 2+ months ago and still open get a gentle "still open?" nudge, including for funds with no linked budget category.
- **Settlement is per-occurrence, not per-row** — settling one month of a recurring planned transaction (e.g. a routed paycheck split) doesn't affect its other future occurrences. Settling one leg of a transfer between two funds settles both legs together, so money can't silently vanish from the combined projection.
- **Plans can now pin which Budget Profile and Contribution Profile are "active."** Create a Plan, pin a profile to it from the Budget page or the top bar, and every page reflects that pin while you're viewing the Plan — without changing what's active for Main Plan or anyone else. Useful for modeling a real what-if (a future relocation, a new job's contribution elections) without disturbing your everyday numbers.
- **The Savings Profiles tab now shows a live pool estimate** next to the stored allocation total for the mode you're viewing, so you can see at a glance whether your saved %/$ splits are over- or under-allocating your actual take-home leftover.
- **The Live Balance dashboard card can now roll accounts up by institution instead of account type**, via a toggle next to the breakdown.
- **The Retirement dashboard card now flags that its Coast FIRE age is the deterministic baseline**, distinct from the simulated-confidence age shown on the Retirement page's Plan Health tab.

### Improved

- **Contribution Profiles, Budget Profiles, and Savings Profiles tabs now share one consistent look** for which profile is active, pinned by a Plan, or just being viewed, plus a one-click Activate action — previously each tab had its own inconsistent indicator.
- **The Budget page's top pills now distinguish a Plan's pinned profile from the true global-active one** when they differ, instead of both silently reading "Active."
- **Budget page tabs reordered to Contributions → Budget → Savings**, matching the order money actually flows through them, with a short explainer under the page title.

### Fixed

- **Adding a new budget category or item, or editing a budget column/mode, while viewing a non-active budget profile could silently land the change on the active profile instead** — the one you weren't looking at. This affected every kind of budget edit made from a non-active profile.
- **The Budget and Savings pages could silently disagree with Paycheck, Contributions, and Expenses about which contribution profile was in effect**, showing different dollar figures for what was supposed to be the same profile.
- **The Live Balance dashboard card's percentage figures showed "percent of total portfolio" where they were labeled "percent changed."** Both the per-category and headline drift percentages now reflect actual day-over-day change.
- **Net Worth, Historical, and Assets pages could disagree about which mortgage loan was "active"** when more than one loan existed, due to each page resolving it independently.
- **Savings projections silently dropped planned transactions dated later in the current month.** Once the 1st of the month had passed, the projection trajectory skipped the entire current month (contributions and any planned withdrawals/deposits alike) instead of just avoiding double-counting the month's contribution for YNAB-linked goals. A sinking fund with an upcoming expense planned for later in the month would show future balances overstated by that amount until the following month. A second, independent copy of the same stale offset logic in the Transactions tab's "balance after" column has been fixed too.
- **The dashboard's Savings Goals card computed its own independent balance projection** that never applied the current-month double-counting guard above, and didn't expand recurring planned transactions at all when checking for shortfalls. Both the Savings page and the dashboard card now share one projection implementation.
- **Extra-paycheck routing silently destroyed savings-transaction history.** Every job or routing-rule save deleted and regenerated _all_ auto-generated planned transactions, even ones dated in the past — they only survived by accident, whenever the regeneration job hadn't happened to run recently. Past and settled rows are now preserved.
- **Restoring a v0.7.0-tagged backup would fail with "Unknown schema version.".** The backup-compatibility layer never registered the v0.7 baseline schema tag.

## [0.7.0] - 2026-08-07

> What changed since v0.6.0. For patch-level detail, see the v0.6.x entries below.

### Upgrading from v0.6.x

Pull the new image and restart — your database upgrades automatically. The migration runner detects the v0.6 schema, creates a pre-upgrade backup, and applies the v0.7 baseline in place with no manual steps.

### Added

- **SimpleFIN Bridge integration — daily linked-balance pulse.** Connect a SimpleFIN Bridge setup token in Settings to automatically pull balances from your linked financial institutions once a day, independent of your weekly manual portfolio snapshot, with per-account include/exclude control and many-to-one account matching for institutions that split one real-world account across multiple SimpleFIN entries.
- **"Live Balance" dashboard card**, showing drift between your synced SimpleFIN total and your last manual snapshot, broken out by account type.
- **New Upkeep page for tracking home utilities** — log electric, gas, water, and other recurring bills over time, with an import option for existing records.
- **Annual Performance: custom account/year-range filtering** — pick a specific set of accounts and a year range (Since Inception, YTD, Last N Years, or custom) to see an annualized and cumulative return for exactly the accounts you care about.
- **Savings: "Update %" action** for percentage-based goals, and a preview step before "Recalculate All %" showing current vs. recalculated amounts before applying.
- **Budget: reorder categories/items**, and bulk sync-direction control per category group.
- **The Growth Factor card's "age" is now editable**, instead of being locked to your configured retirement age.

### Improved

- **A broad internal consistency pass** centralized color definitions, number/percentage formatting, and category-name handling into single shared sources.
- **22 new automated checks now run on every change** to catch unsafe secret comparisons, unguarded "Infinity%" math, raw account keys leaking into the UI, and similar bug patterns before they can ship again.
- **Dashboard cards surface more of what's already being fetched**: Mortgage's payoff date, Retirement's Pre-tax/Roth/HSA/After-tax balance breakdown, Budget's actual-spend-vs-budgeted progress bar with a top-category breakdown, and a reflowing grid that no longer leaves gaps for integration-only cards like Live Balance.
- **Pushing or pulling budget/savings data to YNAB now shows a success toast with the item count** and elapsed time during longer pushes.

### Fixed

- **On the default (SQLite) database setup, several features were silently broken**: Reset All Data, backup version create/restore/export/import, the admin data browser, Monte Carlo retirement simulations (including Coast FIRE), and scenario what-if overrides. All now work correctly on SQLite installs.
- **SimpleFIN balances now sync automatically once a day** instead of only on manual "Sync Now," and a partial provider error no longer silently discards balances that did come back successfully.
- **Retirement catch-up contribution limits are now calculated per person, by their own age**, instead of averaging ages across a household.
- **ACA subsidy-cliff calculations now use your full Social Security benefit**, not just the taxable portion.
- **Taxable-brokerage and HSA contributions were being silently counted as "Traditional"** on the Paycheck, Contributions card, and Contributions page. The Savings Rate breakdown has been restructured so Retirement/Portfolio (goal) and tax treatment are shown as independent, correctly separated concepts.
- **Percentage-based savings goals no longer silently drift with income changes** — they hold a fixed dollar amount until you explicitly recalculate, with the push preview flagging out-of-date goals.
- **Corrected several places where employer contributions or match were double-counted or miscategorized** in return% figures, rollover accounting, and the Contributions page's employer-match table.
- **Switching a contribution account's owner to "Joint" now actually clears the previous individual owner**, and joint accounts synced through the budget-API integration no longer lose their "Joint" label.
- **A recurring savings transfer or planned transaction with an invalid recurrence interval now correctly rejects the input** instead of silently saving as one-time.
- Numerous smaller display and correctness fixes across dark mode contrast, account color dots, relocation percentage display, "years to FI" scenario leakage, per-person totals keyed by name, and explicitly-entered-0 values being silently replaced with defaults.

### Security

- **Closed an unauthenticated admin-takeover window** in "Reset All Data" — admin logins now survive a data reset, and account creation is blocked once setup has happened.
- **Hardened internal scheduled-task endpoints** (backup export/import, daily sync triggers) against timing-based secret guessing, and closed a gap where two of them were missing demo-mode protection.
- **SimpleFIN setup tokens and account data are now validated before use**, blocking non-HTTPS and private/internal network addresses from being reached through the connection flow.

### Under the Hood

- **Migration squash.** All v0.6.x incremental migrations (PostgreSQL 0000–0006, SQLite 0000–0006) collapsed into a single v0.7 baseline schema file — generated directly from the current schema so there is no hand-editing of column definitions. Existing installs auto-upgrade with a pre-upgrade backup.
- **`utility_reading` and `utility_service` added to versioned backups.** These tables were accidentally omitted from the backup snapshot set since v0.6.5. They are now included; restoring a pre-v0.7.0 backup starts both tables empty, which is safe.
- **Dependencies updated** (Next.js, React, tRPC, and other packages) via Dependabot.

---

# v0.6

## [0.6.8] - 2026-08-07

> Fixes several features that were silently broken on SQLite — Ledgr's default, zero-config database — since they'd only ever been exercised against the PostgreSQL setup.

### Fixed

- **On the default (SQLite) database setup, several features were silently broken and would fail immediately when used**: Reset All Data, creating/restoring/exporting/importing a backup version, the admin data browser, Monte Carlo retirement simulations (including the Coast FIRE calculator), and scenario what-if overrides. All now work correctly on SQLite installs.
- **Switching a contribution account's owner to "Joint" now actually clears the previous individual owner** instead of silently leaving it attached in the background. For most accounts this only affects ownership displays, not calculations — the one exception is a joint account with no linked paycheck, where clearing the owner is what makes its contribution amount count correctly toward household totals instead of being silently misattributed.
- **A recurring savings transfer or planned transaction with an invalid recurrence interval (blank, zero, or negative) now correctly rejects the input** instead of silently saving as a one-time (non-recurring) entry.
- Added an explanation to the Relocation tool's year-by-year portfolio comparison table, which previously had no context for what it was showing.

---

## [0.6.7] - 2026-08-06

> A full-codebase correctness and security review (H1–H12 critical, M1–M46 medium, plus a 130-item cleanup pass) closed out this cycle. Highlights below; the SimpleFIN auto-sync work from earlier in this branch is included.

### Security

- **Closed an unauthenticated admin-takeover window.** Running "Reset All Data" used to leave a brief gap where anyone could create a fresh admin account before you did, because the reset wiped local admin logins but not the flag that says setup is already complete. Admin logins now survive a data reset, and account creation is blocked once setup has happened, closing the gap entirely.
- **Hardened the internal scheduled-task endpoints (backup export/import, daily sync triggers) against timing-based secret guessing**, and made sure every one of them correctly refuses to run against a demo database. Two of these (the startup maintenance task and the daily SimpleFIN sync) were missing that demo-mode protection and have been fixed.

### Fixed

- **SimpleFIN balances now actually sync automatically, once a day.** The daily sync endpoint existed since v0.6.6 but was never wired up to run on its own — balances only updated when you manually clicked "Sync Now." It's now checked hourly (at a randomized offset, per SimpleFIN's own guidance on spreading out request timing) and only calls SimpleFIN's API once real syncing is actually due for the day, so it stays well under their daily request quota.
- **A partial SimpleFIN provider error (e.g. one linked institution needing re-authentication) no longer silently discards balances that did come back successfully** — and any sync error is now visible in the sidebar's Data Updated tooltip instead of only reaching a server log.
- **The sidebar's "Data" freshness label now shows the actual oldest date across sources** instead of just whichever source happened to be listed last.
- **Retirement catch-up contribution limits are now calculated per person, by their own age**, instead of averaging ages across a household — a two-person household could previously see the wrong extra contribution room for one or both people, especially once someone crosses into the 60–63 "super catch-up" window.
- **ACA subsidy-cliff calculations now use your full Social Security benefit**, not just the taxable portion — the previous math could report you as safely under the subsidy cliff when you were actually over it.
- **A new investment category showing up mid-year no longer silently disappears from the annual performance rollup** — it's now included going forward instead of being dropped until the next full recalculation.
- **The Expenses page's savings rate now respects an active salary what-if scenario**, matching every other page, instead of quietly falling back to your real salary.
- **The dashboard's "years to FI" figure could get stuck showing a what-if scenario's result as if it were your real plan.** It's now only ever updated from your actual (non-scenario, non-historical-snapshot) retirement plan.
- **Contribution and paycheck percentage displays no longer show "Infinity%"** for employer-only accounts or when a pay-period calculation divides by zero.
- **Fixed several places where light or dark mode made things hard to read or invisible**: a tooltip with white text on a white background, a strategy-guide card missing its border, and the light-mode theme toggle showing invisible button text.
- **The Roth account color in the Retirement Taxes panel now matches the color used everywhere else** (it was showing green instead of the app's violet for tax-free accounts).
- **Account color dots on the Contributions page are visible again** — they were silently rendering as no color at all.
- **Portfolio account cards show their colored left-accent stripe again** — a CSS formatting issue was dropping it.
- **Restoring a backup while using Actual Budget (instead of YNAB) no longer fails the post-restore sync** — it previously always assumed YNAB regardless of which service you had configured.
- **Retirement page's "current age" is now computed the same way in both the Plan Health and Strategy Comparison tabs** — they could previously disagree at a birthday or year boundary.
- **Fixed a rare case where an override form for salary or budget changes could silently save the change under the wrong household member** — it's now blocked until a person is properly selected.
- **The relocation calculator's "expense increase" percentage now displays correctly** — it was showing a number 100x too large.
- **Non-admin users no longer see (non-functional) Save/Delete controls on the relocation planner's saved scenarios** — those actions require admin and are now hidden instead of failing silently when clicked.
- **Account names in a few places (Portfolio page, snapshot entry) no longer show raw internal keys like "ira" instead of a properly capitalized display name.**
- **Rapid changes to a setting could occasionally get overwritten by a slightly-stale background refresh** — fixed with better tracking of which change is actually the latest.
- **A house's equity percentage no longer shows a nonsensical large negative number when the home's value hasn't been entered yet.**
- Several demo-profile-only data issues (investment return figures stored at the wrong scale, a mismatched account link) that only affected the built-in demo personas, not real data.
- **Taxable-brokerage and HSA contributions were being silently counted as "Traditional" on the Paycheck page, Contributions card, and Contributions page.** Your actual retirement projections (nest egg, withdrawals, RMDs, taxes) were never affected — this was a display-only mislabeling. The Savings Rate card's breakdown has also been restructured: "Retirement" and "Portfolio" now correctly represent whether an account counts toward retirement projections (not whether it's taxed), with Traditional/Roth/After-tax/HSA shown as their own sub-lines under each, since tax treatment and retirement goal are independent of each other — a taxable brokerage account can be earmarked for retirement, and vice versa.
- New performance accounts now default their Category (Retirement vs. Portfolio) to match the Account Type you picked instead of always defaulting to Retirement, so brokerage accounts don't need a manual fix after creation.

### Improved

- **A broad internal consistency pass**: centralized color definitions, number/percentage formatting, and category-name handling that had drifted across the app into single shared sources, so future changes only need to happen in one place. No visible behavior change.
- **22 new automated checks now run on every change** to catch several of the bug patterns above (unsafe secret comparisons, unguarded math that could show "Infinity," raw account keys leaking into the UI, and more) before they can ship again.
- Several dashboard cards now surface data that was already being fetched but never shown: Mortgage's payoff date, Retirement's Pre-tax/Roth/HSA/After-tax balance breakdown, and Budget's actual-spend-vs-budgeted progress bar (from your linked YNAB/Actual data) with a top-category breakdown.

### Added

- **SimpleFIN's last sync time now shows in the sidebar's Data Updated tooltip**, alongside Balance, Performance, and the budget-API sync time.
- **The Growth Factor card's "age" is now editable** — it defaulted to your configured retirement age with no way to see the multiplier at a different age; now you can type any age and reset back to the default.

---

## [0.6.6] - 2026-08-05

### Added

- **SimpleFIN Bridge integration — daily linked-balance pulse.** Connect a SimpleFIN Bridge setup token in Settings to automatically pull balances from your linked financial institutions once a day, independent of your weekly manual portfolio snapshot.
- **Per-account include/exclude control.** Each SimpleFIN-reported account has a checkbox to control whether it counts toward the synced total — useful for excluding accounts you don't want reflected in the linked balance.
- **Many-to-one account matching.** Link multiple SimpleFIN-reported accounts to a single tracked Ledgr account, for cases where historical data splits one real-world account across more than one SimpleFIN entry.
- **"Live Balance" dashboard card.** Shows drift between your synced SimpleFIN total and your last manual snapshot, broken out by account type, with the actual snapshot date and coverage ("N of M tracked accounts linked via SimpleFIN").
- **Net Worth card now shows an "Updated" footer**, combining the portfolio snapshot date and the last YNAB/Actual budget-API sync time, matching the new Live Balance card.

### Fixed

- **Duplicate React key warning in the YNAB account mapping list** when two people share one tracked performance account at the same institution.
- **SimpleFIN setup token and account data are now validated before use**, blocking non-HTTPS and private/internal network addresses (including bracketed IPv6) from being reached through the connection flow.
- **A SimpleFIN sync no longer discards every linked balance** just because one institution reported an error — balances that did come back successfully are still saved.
- **SimpleFIN's "N of M tracked accounts linked" coverage line no longer undercounts** accounts that don't yet have a matching snapshot row, and a missing snapshot now shows as unknown rather than a misleadingly large balance swing.
- **Corrected two more places where employer contributions could be double-counted** or miscategorized: ESPP/401(k) rollover amounts now use the same validated decimal handling as the rest of the performance router, and applying a rollover into an already-finalized year is now blocked consistently whether or not the destination account already has a row for that year.
- **Decumulation-year Roth conversions now consistently affect the capital-gains bracket calculation**, and ramp contributions during decumulation are now attributed to the correct account instead of only the portfolio-level total.
- **Monte Carlo no longer silently discards a configured post-retirement inflation rate** when inflation-risk randomization isn't enabled, and the strategy analyzer is now rate-limited like the app's other expensive simulation endpoints.
- **Savings allocation percentage no longer keeps contributing to a goal after it's converted to a free-form "bucket."**
- **"Recalculate allocation %" now rejects a zero or negative income pool** instead of silently saving a negative monthly contribution.
- **Joint accounts synced through the budget-API integration no longer lose their "Joint" label**, and the Contributions page's employer-match table now includes joint accounts in its total instead of just its displayed rows.
- **Per-person totals on the Portfolio page are no longer keyed by display name**, which could silently merge two different people who happen to share a name.
- **Fixed several places where an explicitly-entered 0 was silently replaced with a default** (0% inflation, 0% down payment, 0% interest rate) instead of being respected.
- **Analytics ticker lookups no longer let a slow response overwrite a newer one**, or persist an invalid number as "NaN" into expense ratio or portfolio weight fields.

### Improved

- **Dashboard grid now reflows automatically** instead of relying on hardcoded column-count breakpoints, so cards that only appear once an integration is connected (like Live Balance) never leave a gap or misalign the layout.
- **Dependencies updated** (Next.js, React, and other packages) via Dependabot.

---

## [0.6.5] - 2026-08-05

### Added

- **New Upkeep page for tracking home utilities.** Log electric, gas, water, and other recurring utility bills over time, with an import option for bringing in existing records.
- **Annual Performance: custom account/year-range filtering.** Pick a specific set of accounts (not just an account type) and a year range — Since Inception, YTD, Last N Years, or a custom range — to see an annualized (CAGR) and cumulative return for exactly the accounts you care about.
- **Savings: "Update %" action.** For percentage-based goals (Car, Travel, Home Project), locks in the goal's current dollar amount and recalculates its stored percentage from that — handy after a raise, when you want to keep sending the same dollar amount instead of automatically pulling in the higher income.
- **Savings: preview before "Recalculate All %".** Bulk recalculating percentage-based goals now shows the current vs. recalculated amount for every goal, with Confirm/Cancel, instead of applying immediately.
- **Budget: reorder categories and items.** Move categories and items up/down within the Budget tab.
- **Budget: bulk sync-direction control per category group.** Set pull/push/both for an entire category group at once in Settings, instead of one category at a time.

### Fixed

- **Percentage-based savings goals no longer silently drift with income changes.** Previously, a salary or budget edit would immediately change what a Car/Travel/Home Project goal contributed, with no visibility into it. These goals now hold a fixed dollar amount until you explicitly recalculate, and the push preview flags any goal whose amount is out of date.
- **Savings amounts pushed to YNAB now match what's shown on screen**, in the Budget page's Savings row, the Savings page, and the push preview — previously these three could disagree.
- **Pushing budget or savings targets to YNAB no longer fails or writes to the wrong field.** Goal amounts now go to the correct field, and push/pull confirmation screens compare against the value that's actually being read and written.
- **Editing a budget item linked to a contribution account now correctly updates your paycheck/retirement contribution** instead of a disconnected copy of the amount.
- **Corrected several places where employer contributions or match were counted twice** in return% figures (Portfolio, year-over-year category rows, and the current in-progress year), which had been understating returns on accounts with employer money.
- **Corrected rollover accounting** so a transfer between two of your own tracked accounts (and ESPP or pension-to-brokerage transfers) nets to zero instead of skewing gain/loss.
- **Employer match and distribution tooltips no longer show a hardcoded discount percentage or broker name.**
- **Budget item and category names no longer get squeezed to nothing** by the always-visible action icons on narrow screens.

### Improved

- **Pushing or pulling budget/savings data to YNAB now shows a success toast with the item count**, and the confirmation modal shows elapsed time during longer pushes so it's clear it's still working.

---

## [0.6.4] - 2026-06-28

### Added

- **Savings: Projected "After" balance column.** The Transactions tab now shows a right-aligned "After" column for each upcoming transaction — the projected end-of-month balance for that fund, matching the Plan table. Balances that go negative are highlighted in red, making it easy to spot when a sinking fund runs short.
- **Savings: Plan table shows monthly contribution amounts.** A "Show allocations" toggle in the trajectory table toolbar reveals how much is contributed to each fund per month. On months without planned transactions the contribution appears inline next to the closing balance; on months that have transactions it appears in a dedicated sub-row so the two figures stay visually distinct.
- **Savings: Extra paycheck override month picker shows only valid months.** When adding a month override under Paychecks & Growth, the month selector now lists only months that actually have a third paycheck. Previously any month could be chosen, but picking a non-extra-paycheck month was silently ignored.

### Improved

- **Savings: Plan table transaction sub-rows are visually indented.** Planned transaction rows now have a `└` prefix and a left-side indent, making it clear they belong to the month above rather than reading as standalone rows.
- **Savings: Plan table flags months where a fund goes negative.** Any row where a visible fund's projected closing balance is negative receives a subtle red background, making potential shortfalls easy to spot without scanning every cell.
- **Savings: Plan table transaction names show in full on hover.** Truncated transaction descriptions in the plan table now reveal the full name in a tooltip.
- **Retirement: Clearer "Future $" vs "Today's $" explanation.** The projection's dollar-mode toggle help now spells out that Future $ does not double-count inflation — it's counted once, through your raise and return rates — and that the gap between the two views is your _real_ raise: the growth that actually outpaces inflation.

### Changed

- **Dependency maintenance.** Picked up all pending dependency updates: the runtime stack (tRPC 11.18, the Postgres driver, React Hook Form, and Lucide icons), the Node base image, and assorted build/test tooling (TypeScript ESLint, Vitest, Prettier, lint-staged, and `@types/node` 26). No user-facing behavior changes.

---

## [0.6.3] - 2026-05-20

### Added

- **Relocation: Today's $ toggle.** The projection table now has a "Today's $" / "Nominal $" toggle matching the Retirement page — all balances deflate by the configured inflation rate so future values are expressed in present-day purchasing power.
- **Relocation: Side-by-side comparison table.** The projection view shows Current Path vs Move Path columns with a Gap column, making the impact of the move immediately visible year by year.
- **Relocation: Planned move year.** Setting a move year in the scenario causes the comparison to use the blended projection (current path until the move, relocation path after) so the gap is $0 before the move date and reflects the true change from that point on.
- **Savings: Fund Tracker shows current balance.** Each fund chip in the tracker now displays the fund's current actual balance alongside its projected end balance, in a two-row card layout with a left-side color bar.
- **Trends: "Show Outdated Data" toggle.** A new checkbox in the spreadsheet controls reveals stale performance values (contributions, gains/losses) instead of showing "Outdated". When active, values render in amber and the column header shows "as of \<date\>" so the staleness is always visible in context.
- **Trends: Pie chart year labels.** The Net Worth Location and Tax Location pie cards now show which year's data they represent as a subtitle.

### Improved

- **Relocation nav item renamed to "Relocation".** The Analysis → Tools nav entry previously said "Tools" even though it only contains the Relocation scenario tool.
- **Savings: Fund Tracker and chart legend** are now contained in bordered, sunken panels so they read as structured controls rather than floating labels.
- **Trends: Financial Health Stats** no longer shows a redundant "was X at year-end YYYY" sub-line in the current year column — the prior year's column already displays that value directly.

### Fixed

- **Pay stub: "HSA" now renders in all caps.** The HSA deduction row was displaying as "hsa" in the per-period pay stub. It now shows "HSA" (alongside FSA and IRA, which receive the same treatment).
- **Savings: Pushing monthly targets to YNAB now works for emergency fund goals.** Goals configured as "Target Balance" were silently failing when pushed — YNAB's month-specific budget endpoint ignores goal metadata, so the app now uses the correct plan-level endpoint for these goals. Monthly contribution goals were unaffected.

### Improved (continued)

- **Budget table no longer shows a YNAB column.** Actual spending data belongs on the Expenses page where it can be reviewed in context. The Pull from YNAB / Push to YNAB buttons remain on the Budget page.
- **Savings moved to Cash Flow in the sidebar.** Savings sits alongside Paycheck, Budget, and Expenses — the section previously called "Wealth" is renamed "Investments" and now contains Portfolio, Performance, and Brokerage.
- **Savings trajectory table columns are now equal width.** The month column has a fixed width and all fund columns share the remaining space evenly, regardless of how many funds are shown or hidden.
- **Small text and chart labels are more readable.** All small-text sizes across the app are now driven by three named tokens (rather than scattered per-pixel values), and the floor for secondary labels was raised. Chart axis ticks and legends were also corrected to use the appropriate size — a number of charts had shrunk these to the same size as floating inline annotations.

---

## [0.6.2] - 2026-05-17

### Added

- **Savings: Extra paycheck yearly growth.** Each person's extra paycheck rules editor now includes a per-year raise rate section (% or flat $/mo) that projects how the savings pool grows over time. The Pool Growth bar at the top of the Paychecks & Growth tab shows the compounded trajectory.
- **Savings: Plan / Manage tabs.** The savings page is reorganised into two top-level tabs — **Plan** (trajectory table, chart, allocations, transactions, paychecks & growth) and **Manage** (fund settings, targets, sub-goals). Overview remains always visible above the tabs.
- **Savings: Hidden funds aggregate column.** Funds toggled off in the Fund Tracker no longer waste blank columns in the trajectory table and contribution grid. Their balances are collected into a compact "N hidden" column on the right so the total picture is never lost.
- **Savings: Inline lock-to-edit on transactions.** The Transactions tab now follows the same lock-to-edit pattern as Performance and Analytics — a padlock icon in the toolbar unlocks the table for inline editing. Clicking any cell activates an input directly in place; changes save on blur or Enter, and Escape reverts. This replaces the previous expand-row form.
- **Sync: Auto-sync on page load.** When enabled, the app automatically syncs your budget API data on page load if it is stale. The stale threshold is configurable in Settings → Integrations (default: 4 hours).
- **Sync: Tap-to-sync.** Clicking the data freshness row in the sidebar triggers an immediate manual sync — works in both collapsed (icon) and expanded (row) sidebar modes.
- **Settings: Sync behavior controls.** A new "Sync Behavior" card in Settings → Integrations lets you toggle auto-sync on/off and set the stale-data threshold (1, 2, 4, 8, or 24 hours).
- **Help: Savings features documented.** The Help page now covers the Monthly Balances history dropdown, fund column toggles, transaction history tab, extra paycheck routing, and auto-recorded monthly balances from sync.

### Improved

- **Savings: Month override modal** opens showing only funds with an active allocation. Zero-allocation funds are accessible via an expandable "+ Add fund" section.
- **Savings: Transactions tab** hides rule-generated extra-paycheck rows by default and marks them read-only with a badge — they can be revealed via a toggle but not accidentally edited or deleted.
- Sync now refreshes mortgage and net worth data in addition to savings, budget, and assets after completing.

### Fixed

- **Savings: Pool growth projection** was reporting inflated growth (≈33% at 0% raise for biweekly earners) because the projection loop used the raw `periodsPerYear / 12` average rather than `budgetPerMonth`, which excludes the extra paychecks that are routed separately. Both the base and projected pool now use the same denominator — 0% raise produces a flat line.
- **Savings: Extra paycheck net pay** is now always computed server-side by running the full paycheck calculator (tax brackets, deductions, contributions) against live DB data. Previously the client UI supplied the value, creating a mismatch risk with the Paycheck page.
- **Savings: Materializer race condition.** Concurrent extra-paycheck saves (e.g. two auto-upgrades firing simultaneously on first load) could race on the delete→insert cycle and produce duplicate rule-generated transactions. The materializer now serializes via a module-level mutex and wraps the replacement in a DB transaction.

---

## [0.6.1] - 2026-05-15

### Added

- **Savings: Monthly Balances history.** A dropdown above the Monthly Balances table lets you show up to 12 months (or all) of actual recorded balances alongside projections. Historical rows are visually distinguished from projected ones, with a "─── Projected ───" separator.
- **Savings: Transaction history.** The same history dropdown is available on the Transactions tab, showing past non-recurring transactions above upcoming ones with a separator.
- **Savings: Fund column toggle.** Clicking a fund chip in the Fund Tracker shows or hides that fund's column in the Monthly Balances table. Hidden funds retain their color position so the remaining columns don't shift colors.

### Improved

- **Savings: Monthly balances auto-recorded from sync.** Each YNAB sync now writes the current month's balance for each linked savings goal to history automatically, so the Monthly Balances history fills in going forward without manual entry. Prior synced months are backfilled from the sync cache on first run.
- **Savings: Projection table starts from next month.** When today is not the 1st, the first projected month is the upcoming month rather than the current one — avoiding a partial month at the top of the table.
- Savings month editor now allows saving allocations below 100% of the pool — useful when that month's contribution needs to go elsewhere. An inline warning shows the unallocated amount before confirming, with context-specific copy for single-month vs. fill-forward actions.

---

## [0.6.0] - 2026-05-01

> What changed since v0.5.0. For patch-level detail, see the v0.5.x entries below.

### Upgrading from v0.5.x

Pull the new image and restart — your database upgrades automatically. The migration runner detects the v0.5 schema, creates a pre-upgrade backup, and applies the v0.6 baseline in place with no manual steps.

### New Features

- **Coast FIRE age.** The Retirement page and Dashboard now answer "when can I stop contributing and still fund my plan through retirement?" A scenario toggle on the projection chart flips all KPIs, bars, and Monte Carlo bands to the Coast FIRE what-if so you can compare directly against your active plan.
- **Analytics page** (`/analytics`). Enter portfolio holdings — tickers, weights, expense ratios, and asset class — for each account and snapshot. See your actual allocation in a donut chart, compare it against your glide-path target in a drift table, track allocation over time, and compute your blended expense ratio. Optional FMP integration auto-fills ticker data.
- **ESPP calculator and pending rollover tracker.** Performance page accounts tagged as ESPP get a quarterly purchase-period input panel that computes gain/loss and pre-fills the performance form. In-flight rollovers between accounts can be tracked, then confirmed when the transfer settles — confirming updates both accounts atomically.
- **Extra paycheck routing.** Biweekly employees who receive a 27th paycheck twice a year can set routing rules that automatically split those checks across savings goals. A new Extra Paychecks tab on the savings Projections card shows upcoming extra-paycheck months and an inline rule editor.
- **Savings page overhauled.** Fund cards are collapsible with a full details panel. Projections live in tabbed views (Monthly Balances, Chart, Allocations, Transactions). Planned transaction events on the trajectory chart are clickable.
- **Bucket mode for savings goals.** A "Bucket" target type creates a free-form holding fund with no fixed target, useful for parking money without a specific goal.
- **Inline transaction editing and show history toggle.** Planned transactions can be edited in place. Past transactions and past allocation overrides are hidden by default behind a "Show history (N)" toggle.
- **Lock-to-edit on editable tables.** Performance, Analytics holdings, and House property tax tables default to locked on load to prevent accidental edits. A padlock icon in the header unlocks each table.
- **Balance consistency warning.** When a portfolio snapshot and a performance record share the same date, a warning appears if the balances diverge beyond a small threshold — and notes if the gap is explained by a pending rollover.
- **Contributions page match toggle.** A new "Incl. match / Excl. match" button lets you override whether employer match is included in the savings rate display, with a highlight when overridden.
- **Mortgage total time saved.** The Mortgage Summary card now shows total months saved versus the original loan with no refinancing and no extra payments, across the full refinance chain.

### Improved

- **Mobile layout and touch targets.** The hamburger button, sidebar nav links, and all action buttons meet the 44 px minimum touch target. Action buttons that were hidden until hover are always visible on touch devices.
- **Relocation projection unified.** Salary-adjusted and non-adjusted views are merged into a single table with plain-English legend labels and help tips on each column.
- **API sync labels are now descriptive.** "↓ Balance from YNAB", "↑ Monthly goal pushed to YNAB", and "Spent in YNAB" replace the previous "pull", "push", and "Activity" labels. The API badge shows the connected service name instead of the generic "API."
- **Portfolio page improvements.** Sub-account labels and tax types can be edited inline. Multiple performance years can be expanded simultaneously. Add and delete account controls moved to the portfolio page to reduce clutter on performance.
- **Tooltips visible in dark mode.** Tooltip backgrounds are now correctly dark in dark mode.
- **Savings budget warning.** Each budget column now shows a "⚠ $X over → fix in Savings" badge when sinking fund commitments exceed the leftover, so over-commitment is visible without switching pages.
- **Plan Health tab.** Plan Health callouts moved into their own tab on the Retirement page.

### Fixed

- **E-fund calculations corrected.** Self-loans and reimbursements are correctly subtracted from the effective needed balance for status, surplus, and relocation projection calculations. Reimbursement notes are no longer double-subtracted.
- **Bonus 401k withholding now scales by contribution rate.** Previously the bonus deducted the flat per-period amount; it now applies the contribution rate against the bonus gross.
- **YNAB-linked goals no longer double-count the current month's allocation.** YNAB's Available balance already includes the current month's budgeted amount; the projection no longer adds it again.
- **Contributions page joint accounts.** Joint brokerage and retirement contributions are now included in summary card totals, savings rate calculations, profile comparisons, and the per-person breakdown.
- **Relocation analysis retirement contributions.** HSA and brokerage retirement contributions were silently excluded from the relocation calculator, causing $0 contribution totals and N/A FI ages. All retirement-category accounts are now included.
- **YNAB snapshot sync deduplication.** Memo-tag matching now uses exact word-boundary checks, preventing `snapshot:1` from accidentally matching `snapshot:10` on resyncs.
- **Budget category contribution totals.** When a category's contribution profile varies across months, the totals row now reads each column's actual contribution amount.
- **Zero-dollar account cap overrides now survive save.** A `$0` cap was treated as absent during serialization and cleared on the next save.
- **Monte Carlo inflation now applies consistently within each trial.** Post-retirement expense growth now uses the trial's sampled inflation rate, not the global deterministic rate.
- **Retirement engine edge cases.** Retirement at current age, uninitialized budget floor at the retirement boundary, mid-year salary-bracket splits, HSA drawdown after retirement, uncapped employer match, and pension-income floor interactions are all corrected.
- **Savings shortfall rows only appear when a withdrawal is present.** The row is now suppressed unless there is an actual shortfall event.
- **SQLite migration hash-mismatch detection no longer triggers false squash recovery.** Only previously-applied entries are checked, not unapplied future entries.

### Under the Hood

- **Migration squash.** All v0.5.x incremental migrations (PostgreSQL 0000–0007, SQLite 0000–0005) collapsed into a single v0.6 baseline schema file — generated directly from the live production schema so there is no hand-editing of column definitions. Existing installs auto-upgrade with a pre-upgrade backup.
- **`pending_rollovers` added to versioned backups.** This table was accidentally omitted from the backup snapshot set since v0.5.6. It is now included; restoring a pre-v0.6.0 backup starts the table empty, which is safe.
- **TypeScript upgraded to 6.0.2.**
- **Large internal file-split refactor (v0.5.2–v0.5.3).** Retirement page, budget page, integrations preview panel, tools/relocation calculator, and projection router split into focused sub-components and modules. No user-facing behavior changes — all 3,243 tests pass.

---

# v0.5

## [0.5.12] - 2026-05-01

### Added

- **Bucket mode for savings goals.** A new "Bucket" target type turns any savings goal into a free-form holding fund with no fixed target amount. Useful for parking money without a specific goal in mind.
- **Transaction names on savings shortfall rows.** When a goal has a funding shortfall, the dashboard now shows the transaction name alongside the amount, making it clear which planned transaction is the cause.
- **Relocation projection unified and expanded.** The Tools page relocation projection now unifies salary-adjusted and non-adjusted views, with plain-English legend labels and contextual help tips on each column.
- **"+" Create split into two actions on the Integrations page.** Adding a new linked item now offers a clear choice between a budget line item and a sinking fund, rather than a single ambiguous button.

### Fixed

- **E-fund self-loan no longer inflates the relocation projection.** Outstanding self-loans and reimbursements are now subtracted from the effective balance before projecting income replacement.
- **E-fund status uses effective needed for all checks.** "Funded" and surplus calculations are now consistent — all checks use the net needed amount (after self-loans) instead of mixing raw and adjusted values.
- **E-fund shows "Funded" and surplus correctly.** The status badge now reads "Funded" when the remaining need is within a half-cent of zero, and shows the surplus amount when the fund is over-target, instead of displaying a negative dollar amount.
- **Bonus 401k withholding now scales by contribution rate.** Previously the bonus paycheck deducted the flat per-period 401k amount; it now applies the contribution rate against the bonus gross, matching how payroll actually works.
- **E-fund no longer double-subtracts reimbursement notes.** Reimbursement notes were being counted twice in the effective needed calculation; the duplicate subtraction is removed.
- **Savings shortfall rows only appear when a withdrawal is present.** Previously a shortfall row could appear even when no withdrawal transaction existed; now the row is suppressed unless there is an actual shortfall event.
- **Mobile layout and touch targets improved across the app.** The hamburger button, sidebar nav links, and all action buttons now meet the 44 px minimum touch target size. The scenario bar wraps gracefully on narrow screens. Action buttons (delete, edit) that were previously hidden until hover are now always visible on touch devices.

### Improved

- **Tooltips now visible in dark mode.** Tooltip backgrounds are now correctly dark in dark mode (previously they blended into the page background and disappeared).
- **Warning banners use a consistent color style.** The bonus estimate and savings warning banners now use the same yellow styling as all other informational banners in the app.

---

## [0.5.11] - 2026-04-28

### Added

- **Extra paycheck routing for biweekly workers.** Biweekly employees who receive a third paycheck roughly twice a year can now set per-job routing rules that automatically apply those extra checks to savings goals. Rules specify which goals receive what percentage of the net pay, so the extra income flows where it belongs without manual allocation each time.
- **Extra Paychecks tab on the savings Projections card.** A new tab shows upcoming months that will have an extra paycheck (based on the projection window), with an inline editor for managing routing rules. The net-pay snapshot is sourced automatically from the paycheck calculator — no manual entry required.
- **Contribution grid now marks rule-sourced months.** Months where the extra-paycheck routing rule applied an allocation show a purple ✦ badge, making it easy to distinguish automatic rule entries from manual overrides.
- **Transfer transactions now appear in the Transactions tab.** Transfer entries between funds are shown alongside standard planned transactions, giving a complete view of all fund activity in one place.
- **Fund selector in the transaction edit form.** When editing a planned transaction, the target fund is now selectable from a dropdown, making it easy to reassign a transaction without deleting and re-creating it.

### Changed

- **Month labels in the contribution grid and Monthly Balances tab now include the day** ("Jan 1 '26") to make explicit that contributions are applied on the 1st of each month. A legend note reinforces this below the grid.

### Fixed

- **YNAB-linked goals no longer double-count the current month's allocation.** YNAB's "Available" balance already includes the current month's budgeted amount. The projection loop was adding the monthly allocation on top of that, causing the first month's projected balance to be overstated. The projection now skips the current-month addition when the live balance already reflects it.

---

## [0.5.10] - 2026-04-28

### Added

- **Savings page overhauled.** Fund cards are now collapsible with a full details panel per fund. Projections moved into tabbed views (Monthly Balances, Chart, Allocations, Transactions). Planned transaction diamonds on the trajectory chart are now clickable to show event details in the tooltip.
- **Savings Allocations tab supports inline pool editing.** The monthly pool amount in the Allocations modal is now editable inline — change the pool for a specific month without touching the underlying goal settings.
- **Allocated column in the contribution grid is now clickable.** Clicking any cell in the Allocated column opens the month override editor for that month, matching the behavior of all other clickable rows.
- **Budget page warns when savings allocations exceed capacity.** Each column's Savings row now shows a per-column "⚠ $X over → fix in Savings" badge when total sinking fund commitments exceed the available budget leftover, so over-commitment is visible without switching pages.
- **Savings changes bust the budget cache.** Updating or deleting a savings goal now invalidates the budget summary query, so the budget warning always reflects the current savings state.

### Fixed

- **Income Replacement projection now starts from the true e-fund balance.** Previously the projection used the raw YNAB balance as the starting point, which made the Income Replacement column appear flat at the target value. It now uses the true balance (YNAB balance minus outstanding self-loans/reimbursements), so the trajectory reflects the real starting point.
- **Overview section resized to 3-column grid** after Bonus Leftover card was removed; was still rendering at 25% width per card.
- **Projections header no longer shows budget mode selector.** The Standard/Tight/Emergency pills and cross-mode comparison section were removed; the year selector is the only control remaining.

### Removed

- **Investments/long-term goals section removed from savings page.** Brokerage goals are on the dedicated Investments page; the duplicate added noise without value.
- **Total Balance footer removed from the Allocations contribution grid.** The aggregate balance row at the bottom of the grid was misleading and has been removed.
- **Bonus Leftover hero card removed from savings Overview.** The value is accessible through Budget; the card was redundant.

## [0.5.9] - 2026-04-22

### Added

- **Contributions page now has a match toggle.** A new "Incl. match / Excl. match" button in the contributions page header lets you override whether employer match is included in the savings rate display. Defaults to the same high-income threshold logic used on the dashboard savings card, and highlights when overridden.
- **Contributions page now shows a match toggle aligned with dashboard logic.** Savings rates on the contributions page now use `savingsRateWithMatch` / `savingsRateWithoutMatch` from the router (same values used by the dashboard), so the two views are always consistent.
- **Lock-to-edit padlock on Performance, Analytics Holdings, and House Property Tax tables.** All three inline-editable tables default to locked on page load to prevent accidental edits. A padlock icon in the table header unlocks editing. Performance table lock sits inline in the Return column header; Analytics holdings lock appears per-account card; House property tax lock is in the card header alongside the Add button.
- **Mortgage Summary card now shows total time saved across the full refinance chain.** Previously showed only "months ahead of schedule" from extra payments on the current loan. Now shows total months saved vs. the original loan with no refinancing and no extra payments (e.g., "14 yr 1 mo ahead of original timeline"), with the breakdown visible in the Refinance Impact section helpTip.
- **Refinance Impact section now includes a "Total Time Saved" row.** Appears below "Net Interest Saved by Refinancing" with a helpTip that decomposes the savings into refinancing benefit and extra-payment benefit.

### Fixed

- **Contributions page no longer double-counts high-income match exclusion.** Match override state is now a nullable boolean so "auto" (follow threshold logic), "force include", and "force exclude" are distinct states with no ambiguity.

## [0.5.8] - 2026-04-22

### Fixed

- **Relocation Analysis now correctly counts all retirement contributions.** HSA and brokerage retirement contributions were silently excluded from the relocation calculator due to a wrong internal category check, causing the contribution total to show $0, FI ages to show "N/A", and projection table row highlights to never fire. All retirement-category accounts are now included, matching the behavior on every other page.
- **Relocation projection row highlights and legend swatches are now visible in dark mode.** The current-FI, relocation-FI, earliest-move, expense-adjustment, and large-purchase highlight colors were missing dark-mode variants, making them invisible against dark backgrounds.
- **Contributions page Portfolio and Retirement cards now include joint accounts.** Joint brokerage and joint retirement contributions were excluded from the summary card totals and savings rate calculations, showing $0 and 0% for households with joint accounts.
- **Brokerage page now uses the active contribution profile when projecting.** If a contribution profile was selected, the Funding Sources card reflected it but the projection engine was still using live contribution data — causing the two panels to show different numbers for the same scenario. They now use the same inputs.
- **Contributions Profile Comparison now includes joint accounts.** The Profile and Current columns in the Profile Comparison table were asymmetric — Current included joint account contributions but the Profile column did not, producing a false delta for households with joint brokerage or retirement accounts.
- **Contributions page now shows a Joint section for joint accounts.** Accounts not tied to a specific person (e.g., joint brokerage) were counted in totals but never displayed as their own breakdown card. A Joint section now appears after the per-person sections showing each account's employee contribution, employer match, and total.

---

## [0.5.7] - 2026-04-19

Inline transaction editing, API label clarity, and history toggle for past items.

### Added

- **Inline transaction editing** — planned transactions can now be edited in place from both the fund card and the Upcoming Milestones panel. Click the pencil icon on any non-transfer transaction to change the date, amount, description, or recurrence without opening a separate form.
- **Show history toggle** — past planned transactions and past monthly allocation overrides are now hidden by default and revealed with a "Show history (N)" toggle. Upcoming and current items remain always visible.

### Changed

- **API badge now shows the connected service name** (e.g., "YNAB") instead of the generic "API" label.
- **Sync direction labels are now descriptive**: "↓ Balance from YNAB", "↑ Monthly goal pushed to YNAB", and "Spent in YNAB" replace the previous "pull", "push", and "Activity" labels.

### Fixed

- **Portfolio bar chart bars now all start at the same horizontal position.** The account label column is now fixed-width so shorter labels no longer cause bars to shift left.

---

## [0.5.6] - 2026-04-19

ESPP calculator, pending rollover tracker, balance consistency warning, portfolio label editing, and performance page UX improvements.

### Added

- **ESPP calculator** — accounts tagged as ESPP now show a quarterly purchase period input panel on the performance page. Enter raw purchase data (amount withheld, market value, gross proceeds, commission, dividends kept) and the app computes your gain/loss and pre-fills the performance form. Multiple periods stack; totals roll up into a YTD summary before you apply.
- **Pending rollover tracker** — track in-flight rollovers between accounts before they settle. Create a pending rollover with an estimated amount, then confirm it with the actual amount when the transfer lands. Confirming atomically updates both the source and destination account performance records in a single transaction. An amber notice above the performance table shows open rollovers at a glance.
- **Balance consistency warning** — when a portfolio snapshot and a performance record share the same date, a warning appears if the balances diverge beyond a small threshold ($5 or 0.01% of portfolio, whichever is larger). The warning notes if the gap is explained by a pending rollover.

### Changed

- **Sub-account labels can now be edited inline.** Click the pencil icon next to any sub-account row on the portfolio page to rename it. Clearing the label reverts to the default sub-type or tax-type name.
- **Sub-account tax type can now be changed on the portfolio page.** A dropdown lets you switch a sub-account between Traditional, Roth, and other tax types without leaving the page.
- **Joint account sub-account labels now lead with the owner name.** Owner name now appears before the account type label instead of after it.
- **Portfolio page layout: per-person detail and bar chart now sit side by side** (larger screens), with the bar chart taking three-quarters of the width to give account names more room.
- **Multiple performance years can now be expanded simultaneously.** Previously opening one year automatically closed the previous one; now each year header toggles independently.
- **Add and delete account controls have moved to the portfolio page.** The performance page is now read and edit only — account structure is managed from portfolio, reducing clutter on the performance view.
- **Historical page chart tooltips now format account names as "Institution — Account Type"** (e.g., "Vanguard — Retirement Brokerage") instead of the previous reversed format that duplicated the institution name.

### Fixed

- **Sub-account sub-type and custom label were silently dropped when creating a new snapshot.** Employer Match and Rollover sub-types entered on previous snapshots were not carried forward, so every new snapshot had to be re-tagged manually.
- **Performance page crashed on load after upgrading from v0.5.5.** The pending rollovers migration file was present but missing from the migration journal, so the database table was never created. The app now applies the migration correctly on startup.
- **Pending rollover account labels now respect the display name priority rules** applied throughout the rest of the app (friendly name → stored label → constructed fallback).
- **Balance mismatch warning could miss incoming rollovers.** The pending rollover explanation only checked rollovers originating in the current year; rollovers from a prior year applying to the current year were ignored. Both directions are now checked.
- **Pending rollover badge "in" direction compared the wrong ID type**, causing the incoming-rollover indicator to never appear on destination account rows.
- **Account label column in the portfolio bar chart could overflow on narrow screens.** The fixed-width label column now shrinks correctly to yield space to the bar and amount columns.

---

## [0.5.5] - 2026-04-18

Feature release — Analytics page, performance formula fix, contribution entry improvements, and snapshot UX overhaul.

### Added

- **Analytics page** (`/analytics`) — a new dashboard section for entering and tracking portfolio holdings across accounts and snapshots.
  - Per-account holdings table: enter tickers, weights (basis points), expense ratios, and asset class classifications for each position.
  - **FMP ticker lookup**: optional Financial Modeling Prep integration auto-fills name, expense ratio, and suggests an asset class from the sector. Requires an FMP API key in Integrations settings.
  - **Coverage indicator**: warns when account weights deviate more than 5% from 100%.
  - **Allocation donut chart**: shows actual allocation breakdown by asset class, normalised over classified holdings only.
  - **Drift table**: compares actual allocation to the glide-path target for the user's age, with per-class under/overweight breakdown.
  - **Historical allocation chart**: line chart of allocation over time when two or more snapshots have holdings data.
  - **Blended expense ratio**: first-year weighted average cost across the entire portfolio.
  - Snapshot-to-snapshot copy: duplicate holdings from a prior snapshot as a starting point for a new one.
  - All accounts aggregate view in the donut, drift, and blended ER panels.
- **`account_holdings` table** — new schema table with unique constraint on `(performanceAccountId, snapshotId, ticker)`, FK cascade deletes, and decimal expense ratio.

### Changed

- **Performance update form now shows Employee and Employer contributions separately.** Enter your employee contribution and employer match independently — the app computes and displays the combined total automatically.
- **Portfolio and performance snapshot forms now open in a slide-out drawer** instead of expanding inline on the page. Accounts are grouped by institution so you know which site to visit for each balance.
- **Projection table and simulation loader now use skeleton loading** — no layout jump when data arrives. Simulation phases can be loaded independently.

### Fixed

- **Gain/loss calculation was understating investment returns for accounts with employer contributions.** The formula was subtracting the employer match twice (once inside total contributions, once as a separate deduction). Any gain/loss computed by the app's update form was off by the employer match amount. Historical imported data was unaffected.
- **Retirement contribution rate in the historical spreadsheet view was overstating the savings rate** by double-counting the employer match.
- **Joint accounts were showing an individual owner's name** (e.g., "Alice IRA (Brokerage)" instead of "IRA (Brokerage)"). The display name now correctly derives the "Joint" prefix from account ownership type without requiring a data migration.
- **Saving a portfolio snapshot no longer advances the performance "last updated" date.** The two timestamps are now independent.
- **YNAB-synced data no longer falls back to manual values after 24 hours.** Synced data now persists until you manually trigger a resync.
- **SQLite migration hash-mismatch detection no longer triggers false squash recovery.** The check was iterating all journal entries including unapplied ones. Now only previously-applied entries are checked.

---

## [0.5.4] - 2026-04-14

Maintenance release. Bug fixes — no new features.

### Fixed

- **Snapshot sync no longer misidentifies transactions.** The memo-tag check used a substring match, so a `snapshot:1` tag would accidentally match transactions tagged `snapshot:10`, `snapshot:11`, etc. Sync now uses exact word-boundary matching, preventing false positive skips and double-posts on resyncs.
- **Budget category totals now use the correct per-column contribution amounts.** When a category's contribution profile varies across months, the totals row was using a single scalar value for all columns instead of reading each column's actual contribution. Affected users would have seen incorrect monthly contribution totals in the budget summary.
- **Saving a scenario while the page was still loading no longer overwrites its name.** If the save button was clicked before scenario data had finished fetching, the name could be silently replaced with a "Scenario" placeholder. The save is now a no-op until data is ready.
- **Zero-dollar account cap overrides now survive the settings form.** A `$0` cap was being treated as absent (same as an unset cap) during form serialization, causing it to be cleared on the next save. The form now preserves explicit zero values correctly.
- **Profile unlinking in integrations settings now works.** The mutation that removes a linked profile was not accepting a null profile ID, so the unlink action had no effect. It now sends `null` and the link is correctly cleared.
- **Withdrawal comparison card now shows an error state when analysis fails.** Previously, an analysis error was displayed as "no improvement found" — an unrelated message that could mislead users into thinking the comparison ran successfully. A dedicated error state is shown instead.
- **Monte Carlo projections now apply inflation consistently within each simulation path.** In stochastic runs, each trial samples its own inflation rate — but the retirement budget was being inflated by the global deterministic rate instead of the trial's sampled rate, causing the per-trial budget calculation to be inconsistent with the rest of that trial's outcome.
- **Portfolio quick-look stats no longer crash when all snapshots share the same date.** The sharpest-gain and sharpest-loss calculations are now returned as `null` (displayed as "not enough data") rather than throwing on an empty reduce.

### Removed

- **`home_improvements_cumulative` column dropped from the annual net-worth table.** This column was never read by the app (cumulative figures are derived from the source table at query time) and was being written with stale data. Removed as dead weight — no data or behavior is affected.

---

## [0.5.3] - 2026-04-14

Maintenance release. Engine correctness fixes and internal reorganization — no new features.

### Fixed

- **Retirement projections now handle the case where retirement age equals current age.** Previously the projection engine would skip the final partial accumulation year, leaving contributions unapplied for the current year and producing incorrect nest-egg totals.
- **Per-phase retirement budget is now set up before the first projection year runs.** An edge case near the retirement boundary could produce projections that used an uninitialized budget floor for the first year.
- **Mid-year job change: paycheck tax brackets now split correctly at the salary boundary.** Previously, paychecks straddling a mid-year raise could apply the wrong marginal tax rate.
- **HSA funds are now drawn down correctly after retirement.** A gap in the decumulation logic left HSA balances growing unused in post-retirement years instead of being spent.
- **Employer match is now capped at the plan maximum before being counted toward annual totals.** High-contribution scenarios could previously exceed IRS limits via uncapped match.
- **Pension income now reduces the savings floor before the minimum contribution is enforced.** Plans with significant pension income were over-saving to meet a floor that pension income already satisfied.

### Internals (no user-facing changes)

Internal refactors to improve separation of concerns. All changes are pure relocation or extraction — no behavior changes.

- Budget page, contribution account settings, and portfolio quick-look panels broken into smaller, focused pieces for maintainability.
- Portfolio quick-look stats extracted as a standalone pure function with 18 new unit tests, making the logic independently verifiable.
- Shared state on the budget page lifted into a context object to eliminate redundant prop threading; expensive derived data wrapped in proper memoization to avoid unnecessary recalculation.

---

## [0.5.2] - 2026-04-14

Maintenance release. No user-facing features or behavior changes — this is an internal reorganization to keep the codebase reviewable as it grows.

### Changed

- **TypeScript upgraded to 6.0.2** (dev dependency only; no runtime effect). Also picked up minor version bumps for `jsdom`, `prettier`, and `vitest` that were already on `main`.

### Fixed

- **Performance category tabs** — help tooltips now source their labels from the shared label config instead of a local duplicate map. Silent drift only; the displayed labels were already correct via CSS uppercase, but the underlying keys diverged from the canonical constants.
- **Savings contribution grid** — the monthly total cell now uses the shared currency formatter instead of a hand-rolled `.toLocaleString()` string. Same output, but consistent with every other currency cell in the app.

### Internals (no user-facing changes)

Large internal file-split refactor. Every change below is pure relocation, validated byte-identical via the existing engine snapshot parity test (64 inline snapshots for `calculateProjection` output) plus a new `baseEngineInput` snapshot guard. All 3,100 tests pass both before and after the refactor.

**Directory splits with preserved public APIs:**

- Projection router is now a directory (`scenarios.ts`, `monte-carlo.ts`, `strategy.ts`, `stress-test.ts`, `presets.ts`, `_shared.ts`) composed via `mergeRouters(...)`. The top-level `projectionRouter` export is unchanged.
- `projection-year-handlers.ts` (1,983-line engine file) split into 8 focused modules under `projection-year-handlers/` — `types`, `context`, `state`, `pre-year-setup`, `accumulation-year`, `decumulation-year`, `helpers`, and a barrel `index.ts`. Consumer import path (`./projection-year-handlers`) resolves to the same public surface.
- `buildEnginePayload` extracted from the retirement router into a new retirement-scoped module at `server/retirement/build-engine-payload.ts`. The function was only consumed by the projection router's compute endpoints.
- Six `sync-*.ts` router files consolidated into a `sync/` directory, matching the `projection/` and `settings/` layouts.

**Page-level splits (content-component + section sub-components):**

- **Retirement page** split into 9 section components (Social Security, Taxes, Healthcare, Glide Path, Timeline, Income, Strategy Params, Per-Phase Budget, Raise+Rate) with shared prop types. Parent dropped from 2,001 to 673 lines.
- **Budget page** split into an SSR shell (45 lines) + a client content component + 5 section sub-components + 5 per-section mutation hooks + a shared invalidate hook.
- **Integrations preview panel** split into 5 section components (drift banner, budget, savings, contrib, portfolio) with 5 per-section mutation hooks. The per-section hook shape prevents whole-panel re-renders when an unrelated section's mutation fires.
- **Tools / Relocation calculator** split into 6 sub-components with hand-rolled local prop types.
- **Portfolio page** — 4 already-named in-file components extracted to their own files.

**New safety nets:**

- `engine-input-snapshot.test.ts` — snapshots `baseEngineInput` for a deterministic fixture. Catches any refactor that accidentally changes a default, a derived value, or a memoization dependency in the engine input pipeline.
- `.claude/worktrees/` added to both `.eslintignore` and `.prettierignore` (unblocks repo-wide lint runs when parallel refactor worktrees are active).

**Tests:**

- Two pre-existing failures in `projection-splits.test.tsx` (stale `"Success Rate"` / `"End Balance"` assertions carried over from a v0.5.0 label rename + missing `CoastFireCard` mock) — fixed on both v0.5.1 and v0.5.2 to keep the suite green.

**Navigation comments (not splits):**

- `schema-pg.ts` and `recently-retired.ts` both got section banner comments for navigation but were intentionally NOT split. Splitting `schema-pg.ts` would require rewriting the `gen-sqlite-schema.ts` codegen (mechanical text transform on a single-file input); splitting `recently-retired.ts` fragments what's logically one coherent demo data object.

---

## [0.5.1] - 2026-04-13

### New

- **Coast FIRE age** on the Retirement page and Dashboard — answers "when can I stop contributing and still fund my plan through end of plan?". Binary-searches candidate coast ages via the projection engine and reports the earliest passing age, or flags the plan as already Coast or unreachable. Success criterion: portfolio doesn't deplete AND sustainable withdrawal at retirement covers projected expenses. Displayed in today's dollars
- **Combined baseline + simulated headline on the Coast FIRE card** — shows "Already ✓" only when BOTH the baseline (expected-return) answer and the simulated (1,000 Monte Carlo trials at 90% confidence) answer agree. When baseline says "already" but simulated needs more margin (sequence-of-returns risk), displays the simulated age with a "need age N for 90%" caption. Surfaces the raw simulated success rate at today's age as "Stopping today: X% simulated" so you can see the gap between the two answers
- **Coast FIRE scenario toggle on the projection chart** (labeled "Active Plan / Coast FIRE") — flips the whole chart, hero KPIs, and table to show the Coast FIRE what-if instead of your active plan. Monte Carlo fan bands, deterministic bars, axes, labels, and KPI values all swap atomically. Data is prefetched in the background on page load so the toggle is instant
- **Coast FIRE via contribution profiles** — you can now create a contribution profile with zero contributions and use the existing Overrides panel → Contribution / Salary override to switch to it at a chosen year. Gives you explicit control over when to coast (vs the auto-detected Coast FIRE age) using existing UI. Before this release, the engine silently fell back to a 25% default contribution rate when a switched profile had zero contributions, which defeated the intent
- New **Plan Health tab** on the Retirement page — Plan Health callouts moved into their own tab alongside Projection and Strategy Comparison, instead of being rendered above every other view

### Changed

- **Sidebar: "Historical" moved from Analysis into Net Worth.** The Historical page is a year-end net worth ledger — it belongs next to the Trends summary under Net Worth, not alongside forward-looking tools like Retirement and Contributions. Help content mirrors the new grouping.

### Fixed

- **Monte Carlo assumptions bar: "initial rate" typical-range hint is now strategy-aware.** The sub-label under the withdrawal-rate cell was hardcoded as `3–4%` (the classic fixed-strategy SWR band) even when the active strategy was a dynamic one where sustainable initial rates run higher (~5.0% for Spending Decline, ~5.2–5.6% for Guyton-Klinger per Morningstar 2025). Now shows `4–6%` when the label reads "initial rate" (dynamic strategies) and keeps `3–4%` when the label reads "withdrawal" (fixed). Prevents the misleading implication that a 5% dynamic initial rate is "out of range."

### Engine / internals

- New pure calculator `src/lib/calculators/coast-fire.ts` — additive, calls `calculateProjection()` without modifying the engine
- New tRPC procedures `projection.computeCoastFire` (deterministic, fast) and `projection.computeCoastFireMC` (rate-limited, MC-based binary search with boundary re-probe for non-monotone plans). The MC procedure returns its final-probe `MonteCarloResult` so the chart's fan bands and the hero card's validation read from a single query — no duplicate Monte Carlo runs
- Router-side `buildCoastFireProfileSwitches` helper merges a synthetic zero profile switch with any user-authored profile switches at the coast year. Empty `contributionSpecs`, all-zero employer match, zero base-year contributions/match, contribution rate 0 — lets the engine correctly zero contributions sticky-forward while preserving pre-coast-year user switches
- `projection.computeProjection` and `projection.computeMonteCarloProjection` now accept a `coastFireOverrideAge` input; when set they thread the synthetic profile switch through the engine. Coast FIRE display values deflated to today's dollars at the router boundary (matches the convention used by `retirement-card.tsx`)
- Fixed profile switch fallback at `retirement.ts:860`: when a switched contribution profile has salary but zero contributions, the engine now correctly uses rate 0 (intentional zero) instead of silently falling back to 25%. This unlocks the Coast FIRE via contribution profiles workflow
- Unified terminology across Coast FIRE UI: "baseline" consistently refers to expected-return / point-estimate values, "simulated" refers to Monte Carlo outcomes, "Active Plan" is the scenario toggle name for your configured plan. No more overloaded "baseline" or jargon "deterministic / MC" references in user-facing copy

---

## [0.5.0] - 2026-04-13

> What changed since v0.4.0. For patch-level detail, see the v0.4.x entries below.

### Upgrading from v0.4.x

Pull the new image and restart — your database auto-upgrades on first boot. An existing v0.4 install is detected automatically, the database is backed up before any change, and the v5 schema migration runs in place with zero manual steps.

**New environment variable required in production:** `ENCRYPTION_KEY`. Generate a 32-byte base64 value (`openssl rand -base64 32`) and set it before restarting — without it the container refuses to start. This protects at-rest encryption of your YNAB / Actual Budget credentials.

### Security

- YNAB and Actual Budget API tokens are now encrypted at rest with AES-256-GCM. Existing installs transparently upgrade on first write — previously your budget API credentials sat in the database as plaintext JSON
- User-supplied Actual Budget server URLs are now validated against private IP ranges; the app refuses to connect to loopback, RFC1918, or link-local addresses unless the host is explicitly allowlisted
- If a sync run fails partway through, the budget API cache is now rolled back atomically instead of being left in a half-updated state — you'll either see the new data or the old data, never a mix
- Production deployments now fail loud at startup if the cron secret is missing, if the dev-mode auth bypass is enabled, or (new this release) if the at-rest encryption key is missing. Previously these were silent defaults
- Login sessions now expire after 4 hours instead of 24
- App container now waits for Postgres to pass its healthcheck before starting, eliminating the startup race where the app crashed trying to connect before the DB was ready
- New encrypted off-site backup script — a one-command `pg_dump` wrapped in AES-256 encryption that you can pipe to S3 / rclone / restic, plus a restore-drill runbook
- Bumped Next.js to 16.2.3 to patch a high-severity Server Components Denial of Service advisory (GHSA-q4gf-8mx6-v5v3)
- Projection page write operations now require the scenario permission instead of accepting any signed-in user

### New

**Retirement projections:**

- **Plan Health card** on the retirement page surfaces up to five findings in context: contribution priority warnings (flags taxable-before-tax-advantaged or HSA behind other tax-advantaged accounts), glide path mismatch (compares your current stock allocation against the "110 − age" rule of thumb), rosy-assumption flags (return > 8%, inflation < 2.5%, salary growth > 4%), a recommended withdrawal strategy with a one-sentence rationale, and a ±25% band around your deterministic nest egg estimate so you can see the uncertainty without switching to the Monte Carlo view
- **Stress test panel** runs your plan through three canonical scenarios — Conservative (bottom-decile 30-year returns, elevated inflation), Baseline (long-run US averages), and Optimistic (top-quartile returns). Shows the nest egg outcome for each side by side with your own plan assumptions
- **Strategy picker** now marks the recommended option with "★ … — Recommended" based on your horizon and whether you have a budget linked
- Monte Carlo confidence bands (50% / 80% / 90%) on Balance, Strategy, and Budget views of the Spending Stability chart
- Three-way chart toggle on the retirement page: Balance, Spending Stability, Deterministic
- "Vs Strategy" and "Vs Budget" spending stability donuts — the first measures against year-1 withdrawal, the second against your stated retirement budget
- Strategy Analyzer: opt-in "Analyze My Strategy" button runs what-if scenarios and shows the top 3 parameter changes that would improve success rate or spending stability
- Strategy Guide flyout on Projection and Strategy Comparison tabs explains each strategy's mechanics, strengths, weaknesses, and expected Stability score

**Paycheck view:**

- Three-mode paycheck view: "Current Salary" (forward planning at today's rate), "Year-End Estimate" (blended annual accounting for mid-year raises), and "Actual YTD" (elapsed periods only)
- Year-End Estimate walks each pay period at its effective salary, correctly handling SS cap transitions and percent-of-salary contribution changes across mid-year raises
- All contribution metrics (IRS utilization bars, funding percentages, savings rates, "% to max" recommendations) now react to the View toggle — previously only summary totals changed

**Performance & trends:**

- **Update Performance form** — batch-edit current-year account flow data (contributions, employer match, distributions, rollovers, fees) from a single form instead of clicking individual cells. Ending balance can pull from the latest portfolio snapshot or be entered manually; gain/loss auto-calculates live
- **Lifetime field cascade** — editing account data on a finalized year now recomputes lifetime totals across every subsequent year automatically
- **Spreadsheet view for Trends page** — dense year-over-year comparison, financial health stats, tax location breakdown, and net worth location. Toggle between card and spreadsheet layouts
- **Projected FI Year** — linear extrapolation of when financial independence will be reached, with prior-year reference when current year shows "Progress Stalled"
- **Retirement parent category rollup rows** show combined retirement account totals alongside per-account-type detail
- **Year-over-year comparison** with Projected / Actual YTD toggle — contributions are prorated for meaningful comparisons, gains/losses shown as-is
- **Cost basis tracking** per account on the Performance page Brokerage tab, with computed unrealized gain column
- **Chart X-axis toggle** — switch between Year and Age on the Net Worth Over Time and Journey to Abundance charts

**Per-person retirement engine:**

- Each spouse can now retire at a different age; the still-working spouse continues contributing while the retired spouse stops
- Per-person Social Security with individual claiming ages and per-person breakdown in tooltips
- Per-person RMDs computed from each spouse's birth year and individual Traditional account balances, following SECURE 2.0 rules
- Per-person IRMAA — Medicare surcharge correctly applies to each spouse independently when both are 65+

**Brokerage & contributions:**

- Brokerage page redesigned: single-page layout with collapsed goals and a "Planned Events" replacing the separate Transactions tab
- Today's $ / Future $ toggle with inflation-adjusted view
- Per-account "After retirement" setting — stop contributions, continue until last person retires, or continue indefinitely
- Per-account contribution scaling (with salary or fixed) to prevent fixed-dollar contributions from dropping during staggered retirement
- Portfolio snapshot import automatically pulls YNAB balances for linked tracking accounts

**Overrides:**

- Wizard-style "Add Override" flow — pick year, pick what to change, fill 1-3 fields — replaces three dense forms
- Database persistence — withdrawal rate, routing mode, account caps, Roth conversion targets, and lump sums survive page refresh
- Lump sums target specific accounts and appear in the retirement projection table with In/Out column, contribution columns, and balance tooltips

**Sync (YNAB / Actual Budget):**

- **Drift detection** — after every sync, the app compares the cached account list against what came back fresh and flags broken mappings (accounts deleted upstream), renamed accounts, and new remote accounts so you can fix them in the UI instead of losing sync coverage silently
- **Deterministic idempotency keys** on transaction creation — if a sync is interrupted and retried, the upstream API deduplicates the request automatically instead of creating a duplicate transaction
- **Automatic retry with exponential backoff** on rate-limit / server / network errors (1s → 2s → 4s, capped at 30s), honoring `Retry-After` headers on 429. Authentication errors surface immediately without retry
- **Resync button** on every snapshot row in the Portfolio history table — re-pushes that snapshot to YNAB by removing its previous tagged adjustments and posting fresh ones
- Snapshot-to-YNAB adjustments now carry a traceable memo tag and contributor account names so each YNAB entry points back to the originating Ledgr snapshot
- New portfolio snapshots post one summed adjustment per YNAB tracking-account group instead of a separate transaction per mapping
- YNAB account linking for Retirement Brokerage accounts; linked accounts use YNAB as the balance source of truth

**Accessibility:**

- Users with "reduce motion" preference now get a reduced-animation experience automatically
- Screen readers no longer announce decorative icons as path data — every inline icon in the app is now correctly marked as decorative or labeled
- Sidebar collapsibles announce their expanded/collapsed state to assistive tech
- Amber badges and callouts bumped to darker shades to meet WCAG 4.5:1 contrast on near-white backgrounds
- Data tables now emit proper column-header semantics and the projection table carries a screen-reader caption describing the grid

**Undo & feedback:**

- Deleting a planned savings event now shows a 5-second undo toast — click Undo to restore it instead of having to re-create from scratch
- Form save errors now categorize by type (auth, permission, rate limit, validation, server, network) and show appropriate recovery UI (relogin prompt, cooldown window, retry button) instead of a generic "something went wrong"
- Form edits now update optimistically — the UI reflects your change immediately and rolls back if the save fails

### Improved

- Retirement page now defaults to the Monte Carlo view (the Deterministic / MC toggle was removed — MC overlays on top of deterministic with no unique deterministic-only content)
- All user-facing jargon renamed: "Det" → "Baseline", "MC Bands" → "Confidence Band", percentile notation → confidence percentages, "MC median" → "Sim. median"
- Retirement, portfolio, and networth pages load faster on first paint — the most expensive data query starts on the server before the client mounts
- All chart components are now lazy-loaded, dropping roughly 250KB off the initial download for pages that don't show charts
- Dashboard cards no longer re-render unnecessarily when a single card's query invalidates
- Spending stability chart shows a dollar Y-axis alongside the percentage axis, with withdrawal and plan amounts in tooltips
- Strategy dropdowns now update instantly via optimistic cache updates instead of waiting 7-30s for a full projection recompute
- Health stats on the Trends page show trajectory context when the current year is selected ("was X at year-end YYYY")
- Wealth Score, AAW Score, and FI Progress now computed once in a shared helper — no more inconsistencies across the dashboard, contributions, and savings rate pages
- Wealth Score changed to net worth / lifetime earnings (a clearer savings efficiency percentage)
- AAW Score uses the Money Guy formula with average household age and Combined AGI
- Savings rates use total compensation (including bonus) as the denominator everywhere, instead of mixing salary and total-comp across pages
- Home value cost basis now correctly computed from cumulative improvement items instead of a broken per-year DB column
- Restructured retirement page: spending strategy, budget, and withdrawal rate grouped in a "Decumulation Plan" section; Withdrawal Routing in a compact collapsed view with a sunken expanded panel
- Budget and withdrawal-rate controls visually dim when the selected strategy doesn't use them
- Fixed 148 instances of missing spacing between variables and text across the app
- Softer, theme-aware card borders in both light and dark mode
- Upgraded to Next.js 16 with Turbopack for faster development builds
- "Recently Retired" demo profile with a realistic account mix (401k, 403b, IRA, Roth, brokerage)

### Fixed

**Retirement engine:**

- Post-retirement brokerage contributions no longer inflate retirement projection balances — brokerage-category post-retirement contributions are modeled on the brokerage page only, restoring correct Monte Carlo success rates
- Vanguard, Constant Percentage, Endowment, and RMD strategies now correctly skip post-retirement inflation (dimmed UI settings no longer silently affect projections)
- RMD pre-RMD fallback spending now grows with CPI to maintain purchasing power during the 10-18 year gap before RMD age
- Spending Decline now produces a true real decline instead of a steeper nominal decline that over-cut by the full inflation rate
- Guyton-Klinger guardrail parameters now pair correctly (Upper Guardrail with Increase %, Lower Guardrail with Decrease %)
- Monte Carlo stochastic inflation now affects post-retirement expense growth (previously only pre-retirement inflation was randomized, leaving decumulation expenses fixed across all trials)
- Strategy comparison now uses your saved Monte Carlo inflation overrides instead of the hardcoded 2.5% default

**Contributions & paycheck:**

- Contribution blended estimates no longer double-count when multiple contribution accounts share a single performance account
- Year-End Estimate accounts for stale performance data by filling only the exact missing payroll periods at the current projected rate
- Monthly and annual contributions are no longer flagged stale when biweekly paydays pass
- Over-limit "Over" badge no longer triggers from sub-cent rounding noise
- "Over by" amount for HSA and other match-counts-toward-limit accounts now uses total contribution instead of just employee contribution
- Portfolio employer match (ESPP discount) in YTD view is correctly attributed to portfolio totals instead of retirement match

**Data integrity:**

- Internal data invariants tightened: missing or orphan rows now surface as clear errors instead of silently substituting "Unknown" or zero — bad data is caught early instead of producing wrong-but-quiet numbers downstream
- Historical net-worth records backfilled with correct portfolio tax-location breakdowns

**Budget & expenses:**

- Expense page no longer counts YNAB savings allocations and reimbursements as spending — only outflows are included in actual amounts
- Credit card payment transfers no longer appear as spending
- Year-over-year comparison no longer shows $0 for the prior year

**Other:**

- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values
- First-year pro-rating now excludes the current month after mid-month
- Mortgage current-balance detection no longer reads system time mid-request
- Fixed Docker build failure on Node.js 25

### Under the hood

- All v0.4.x migrations squashed into a single clean v5 baseline — new installs get two migration files instead of dozens
- Pre-upgrade auto-backup handles v0.1.x, v0.2.x, v0.3.x, and v0.4.x databases
- Financial decimal columns widened so no legitimate balance can overflow
- Added two missing foreign-key indexes flagged by the audit
- Finalized annual performance rows are now marked immutable — the only way to modify their lifetime totals is through the proper cascade helper, preventing stale or inconsistent numbers
- 2,977 automated tests (up from ~2,300 in v0.3.0) covering financial calculations, budget API integrations, database compatibility, accessibility regressions, and backup round-trips
- Automated tax parameter staleness check in CI that fails the build if we're beyond the current tax year without a deliberate override
- Three new end-to-end user journeys (auth, scenario edit, sync integration) and a component-level test of the login form contract
- In-app glossary page for finance jargon, with definitions sourced from a single config
- One-command dev quickstart script (`setup-dev.sh`) that installs, configures env, runs migrations, and seeds a fresh dev database

### Known deferred

- Insurance gap analysis cards (life / disability / umbrella / beneficiary tracking) — planned but needs its own design pass
- Expanded test fixture profiles ($250k single earner, gig worker, HENRY) — tracked for a follow-up release

---

# v0.4

## [0.4.21] - 2026-04-12

### Added

- IRS limit utilization bars, funding percentages, savings rates, and "% to max" recommendations now react to the View toggle (Current Salary / Year-End Estimate / Actual YTD) — previously only summary dollar totals changed
- Contribution dollar amounts shown per account type now reflect the active view: Year-End Estimate shows salary-timeline-weighted totals accounting for mid-year raises, Actual YTD shows real performance data

### Fixed

- Contribution blended estimates no longer double-count when multiple contribution accounts share a single performance account — year-to-date actuals are split proportionally by expected contribution
- Employer match is now correctly subtracted out of stored performance totals so employee-only year-to-date amounts aren't inflated by the match
- Year-End Estimate accounts for stale performance data by filling only the exact missing payroll periods at the current projected rate, rather than replacing or ignoring the actuals
- Monthly and annual contributions (IRA, etc.) are no longer flagged as stale when biweekly paydays pass — stale-gap fill only applies to payroll-cadence contributions
- Contribution cadence (monthly vs biweekly vs annual) is now used for the blended remaining-fraction calculation, so monthly IRA contributions don't show false shortfalls against biweekly period counts
- Over-limit "Over" badge and red bar no longer trigger from sub-cent rounding noise
- "Over by" amount for HSA and other match-counts-toward-limit accounts now correctly uses total contribution (employee + match), not just employee contribution
- Portfolio employer match (ESPP discount) in year-to-date view is now correctly attributed to portfolio totals instead of being lumped into retirement match
- Mortgage current-balance detection no longer drifts when requests span a day boundary
- Savings rate card group breakdown (retirement vs taxable) now uses view-aware totals instead of projected-only rates

### Security

- Projection page write operations now require the scenario permission instead of accepting any signed-in user

### Changed

- Blended savings rate uses salary-timeline-weighted total compensation as the denominator, correctly reflecting mid-year salary changes

---

## [0.4.20] - 2026-04-11

### Changed

- Tightened internal data invariants so missing or orphan rows now surface as clear errors instead of silently substituting placeholder values like "Unknown" or zero — bad data is caught early instead of producing wrong-but-quiet numbers downstream
- Historical net-worth records backfilled with correct portfolio tax-location breakdowns from existing legacy columns

### Fixed

- Eliminated several silent fallbacks across the performance, snapshot, and demo flows where missing performance-account links or owner records would default to placeholder text instead of being treated as a real error

---

## [0.4.19] - 2026-04-11

### Fixed

- New portfolio snapshots now post one summed adjustment per YNAB tracking-account group instead of a separate transaction per mapping — totals match Ledgr's view of each tracking account
- YNAB sync now matches Ledgr accounts by ID instead of by display label, so duplicate or renamed labels no longer cause missing or doubled adjustments

### Added

- Resync button on every snapshot row in the Portfolio history table — re-pushes that snapshot to YNAB by removing its previous tagged adjustments and posting fresh ones against the live tracking-account balances
- Resyncing a non-latest snapshot prompts a confirmation warning, since later snapshot adjustments were computed against the old state

### Improved

- Snapshot-to-YNAB adjustments now carry a `snapshot:{id}` memo tag and contributor account names, so each YNAB entry is traceable back to the originating Ledgr snapshot
- If a sync fails partway through, any adjustments already posted are rolled back automatically; if rollback can't complete, the failing transaction IDs are surfaced for manual reconciliation

### Security

- Bumped Next.js to 16.2.3 to patch a high-severity Server Components Denial of Service advisory ([GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3))

---

## [0.4.18] - 2026-04-06

### Improved

- Year-End Estimate mode now uses actual YTD contributions from performance data instead of projecting from current rates — shows what was really contributed plus projected remaining
- IRS limit tracking in Year-End Estimate mode reflects actual contributions for accurate "room remaining" calculations
- Contributions page and dashboard cards in Year-End Estimate mode show actual + projected breakdown

---

## [0.4.17] - 2026-04-06

### New

- Three-mode paycheck view: "Current Salary" (forward planning at current rate), "Year-End Estimate" (blended annual using actual salary changes throughout the year), and "Actual YTD" (elapsed periods only)
- Year-End Estimate mode walks each pay period at its effective salary rate, correctly handling SS cap transitions and percent-of-salary contribution changes across mid-year raises

---

## [0.4.16] - 2026-04-06

### New

- Update Performance form — batch-edit current-year flow data (contributions, employer match, distributions, fees) from a single form with auto-calculated gain/loss
- Lifetime field cascade — editing account data on finalized years now recomputes lifetime totals through all subsequent years

### Improved

- Financial amount fields on performance edits now reject invalid values (non-numeric strings) at the form boundary
- Account type fields validated against the config enum everywhere — previously some edit paths accepted arbitrary strings
- Projection overrides now accept the brokerage permission instead of incorrectly requiring admin
- Demo mode blocks the data import/export API routes (previously these bypassed the demo guard)
- Performance tabs and the finalize modal now share a single category display order

---

## [0.4.15] - 2026-04-06

### New

- Chart X-axis toggle — switch between Year and Age on both Net Worth Over Time and Journey to Abundance charts

### Improved

- Health stats show trajectory context when current year is selected: Wealth Score, AAW Score, and FI Progress display "was X at year-end YYYY" reference from the most recent finalized year
- Projected FI Year uses finalized data as primary projection when current year is involved, with YTD shown as secondary context
- FI Card on card view follows same finalized-primary pattern for consistency

---

## [0.4.14] - 2026-04-06

### New

- Spreadsheet view for Trends page — dense year-over-year comparison table, financial health stats, tax location breakdown, and net worth location. Toggle between card and spreadsheet layouts
- Projected FI Year — linear extrapolation of when financial independence will be reached, with prior-year reference when current year shows "Progress Stalled"
- Retirement parent category rollup rows show combined retirement account totals alongside per-account-type detail
- Year-over-year comparison with Projected Year / Actual YTD toggle — contributions are prorated for meaningful comparisons, gains/losses shown as-is (market-driven)
- Prorated values marked with asterisk and footnote for transparency

### Improved

- All wealth metrics (Wealth Score, AAW Score, FI Progress) now share a single computation path — no more inconsistencies between the dashboard, contributions page, and Trends page
- Wealth Score changed to net worth / lifetime earnings (a clearer savings-efficiency percentage)
- AAW Score uses the Money Guy formula with average household age and Combined AGI
- Market value / cost basis toggle now affects every metric consistently: year-over-year table, health stats, net worth location, pie charts, and Journey to Abundance benchmarks
- Salary averaging toggle now propagates to Journey to Abundance benchmark lines
- Tax location data now snapshots at year-end finalization instead of being re-derived from config
- Home value cost basis correctly computed from cumulative improvement items instead of a broken per-year column
- Current-year gross income includes bonus for wealth-metric denominators
- FI Progress on the dashboard now includes cash (consistent with the Trends page)
- Zebra striping on all spreadsheet tables for readability

### Fixed

- FI Progress calculation was excluding cash
- Tax location breakdown was mixing two key-casing styles and producing duplicate rows
- Wealth score labels are now consistent across the dashboard metrics row and Financial Checkup card

### Changed

- Net worth calculator produces dual market/cost-basis scores for wealth and AAW metrics
- AAW thresholds updated: PAW >= 2.0, AAW >= 1.0 (previously baked in a 2× factor)
- Net worth records now carry a point-in-time tax location breakdown captured at year-end finalization

---

## [0.4.13] - 2026-04-03

### New

- Update Performance form — batch-edit all current-year account flow data (contributions, employer match, distributions, rollovers, fees) from a single form instead of clicking individual cells
- Ending balance source toggle: pull from latest portfolio snapshot (default) or enter manually
- Gain/loss auto-calculated live with manual override option

### Improved

- Savings rates now use total compensation (includes bonus) as the denominator across all pages — contributions, dashboard financial checkup, and savings rate card all show consistent rates
- High-income households ($200K+) see employee-only savings rate as the headline, with match rate shown as secondary
- Spending stability chart now shows a dollar Y-axis alongside the percentage axis, with withdrawal and plan amounts in tooltips
- Spending stability baseline uses the strategy's own target (with post-retirement raise) for strategies that track it, and MC-inflated year-1 withdrawal for dynamic strategies
- Monte Carlo fan bands no longer glitch when switching between confidence band ranges

---

## [0.4.12] - 2026-04-01

### New

- Spending stability charts with Monte Carlo confidence bands — Balance, Strategy, and Budget views all show simulated outcome ranges
- Toolbar restructured: chart controls co-located with chart header, table controls co-located with table header, main toolbar reduced to global controls only
- Independent Baseline (On/Off) and Confidence Band (Off/50%/80%/90%) controls across all chart views
- Strategy Analyzer with opt-in "Analyze My Strategy" button running what-if Monte Carlo scenarios

### Improved

- All user-facing jargon renamed: "Det" to "Baseline", "MC Bands" to "Confidence Band", percentile notation to confidence percentages, "MC median" to "Sim. median"
- "Deterministic + MC Simple + MC Advanced" badges simplified to "Baseline + Simulation"
- Strategy param dropdowns now update instantly via optimistic cache updates (previously waited 7-30s for full projection recompute)
- Spending stability chart uses bar chart matching Balance view visual pattern (same colors, opacities, fan band layers)

### Fixed

- Strategy param dropdowns (Base Withdrawal %, Ceiling, Floor, etc.) not persisting — settings return object was missing all strategy param fields, causing dropdowns to always show defaults
- Dollar mode (Today's $/Future $) now syncs correctly between Projection and Strategy Comparison tabs
- Removed dead Deterministic chart tab (Fan Bands selector already provided this functionality)

---

## [0.4.11] - 2026-04-01

### New

- Dual spending stability donuts: "vs Strategy" measures against year-1 withdrawal, "vs Budget" measures against your stated retirement budget — shows whether the strategy covers what you actually need
- Strategy Analyzer: opt-in "Analyze My Strategy" button on the comparison tab runs what-if MC scenarios and shows the top 3 parameter changes that would improve your success rate or spending stability

### Improved

- Both stability columns (strategy + budget) shown in the strategy comparison table
- Budget stability metric added to the Monte Carlo engine — compares withdrawals against your retirement budget (inflation-adjusted) instead of year-1 withdrawal

---

## [0.4.10] - 2026-04-01

### Improved

- Today's $ / Future $ toggle on the Strategy Comparison tab, shared with the Projection tab — toggling one updates both
- Strategy guide content moved into the withdrawal strategy config so every strategy's help text is maintained in one place
- Removed the dead Compact/Expanded table toggle (All Years toggle already provides this)
- Decumulation settings layout further compacted with a 2-column strategy parameter grid

---

## [0.4.9] - 2026-04-01

### Fixed

- Withdrawal engine now correctly skips post-retirement inflation for strategies that don't use it (Vanguard, Const %, Endowment, RMD) — dimmed UI settings no longer silently affect projections
- RMD pre-RMD fallback spending now grows with CPI to maintain purchasing power during the 10–18 year gap before RMD age
- Spending Decline now produces a true real decline (spending grows nominally with CPI minus the decline rate) instead of a steeper nominal decline that over-cut by the full inflation rate
- Guyton-Klinger guardrail parameter grouping corrected — Upper Guardrail now pairs with Increase % (prosperity) and Lower Guardrail with Decrease % (capital preservation)

### Improved

- Endowment rolling window default changed from 10 to 5 years, matching standard university endowment practice (Yale/Stanford use 3–5 years)
- Strategy Guide flyout added to both Projection and Strategy Comparison tabs — explains each strategy's mechanics, strengths, weaknesses, and what to expect from the Stability metric
- Stability column tooltip now explains why budget-based strategies score higher and portfolio-linked strategies naturally score lower
- Decumulation settings layout compacted: Post-Retirement Raise and Withdrawal Rate shown side by side; strategy parameters flow in a 2-column grid
- Timeline and Income sections merged into a single left-column box in Projection Assumptions, reducing whitespace

---

## [0.4.8] - 2026-04-01

### Improved

- Retirement page redesign: removed redundant deterministic stats row and depletion warning banner (info moved to hero card subtitles)
- Three-way chart toggle: Balance | Spending Stability | Deterministic — spending stability shows withdrawal trajectory as % of initial plan with 75% threshold line
- MC assumptions bar relocated from below chart to below hero cards — assumptions before evidence
- Chart view toggle and table compact/expanded toggle in control bar
- Strategy Comparison moved to page-level tab with table and chart shown together (no toggle needed)
- Hero cards standardized: "Funding Outlook" replaced with "End Balance" showing MC median
- Rich tooltips for Success Rate and Spending Stability donuts with threshold explanations and time horizon context
- MC summary bar shows only assumptions (preset, return, volatility, rate, inflation, trials) — no longer duplicates hero card metrics
- Strategy comparison refreshes automatically when MC settings change

---

## [0.4.7] - 2026-03-31

### Improved

- Renamed "Spending Adequacy" to "Spending Stability" — compares withdrawals to the initial year-1 withdrawal (inflation-adjusted) instead of the strategy's own target, properly measuring whether dynamic strategies maintain the planned income level
- Strategy comparison now refreshes when MC settings change (inflation, glide path, asset classes)
- Loading skeleton shown for hero cards while MC simulation runs instead of flashing deterministic cards

---

## [0.4.6] - 2026-03-31

### Improved

- Retirement page now defaults to Monte Carlo view — the Deterministic/Monte Carlo toggle has been removed since MC overlays on top of the deterministic projection with no unique deterministic-only content
- Spending adequacy now visible in the hero success rate card, below the donut

---

## [0.4.5] - 2026-03-31

### Added

- Spending Adequacy metric — shows what percentage of Monte Carlo trials maintained at least 75% of target withdrawals in every retirement year, surfaced alongside success rate in both the MC results summary and strategy comparison table
- Clear tooltips distinguishing success rate (portfolio survives — industry standard) from spending adequacy (income holds up — catches dynamic strategy spending cuts)

### Fixed

- Strategy comparison now uses saved MC inflation overrides instead of hardcoded 2.5% — results match the main retirement page
- Plan Assumptions "Inflation" badge corrected from "Deterministic + MC" to "Deterministic" with updated tooltip explaining that MC uses stochastic inflation from the preset

---

## [0.4.4] - 2026-03-31

### Fixed

- Monte Carlo stochastic inflation now affects post-retirement expense growth — previously only pre-retirement inflation was randomized, leaving decumulation expenses at a fixed rate across all trials
- Restored projection scope badges on the retirement page section headers showing which settings affect Deterministic, MC Simple, and MC Advanced modes (lost in an earlier refactor)

---

## [0.4.3] - 2026-03-31

### Fixed

- Expense page was counting YNAB savings allocations and reimbursements (positive activity) as spending — only outflows (negative activity) are now included in actual amounts

---

## [0.4.2] - 2026-03-31

### Fixed

- Post-retirement contributions for Portfolio-category accounts now appear in the brokerage page Year-by-Year table — values are shown in the brokerage view without inflating retirement engine balances

---

## [0.4.1] - 2026-03-30

### Fixed

- Portfolio-category (brokerage) contributions no longer inflate retirement projection balances — post-retirement brokerage contributions are modeled on the brokerage page only, restoring correct Monte Carlo success rates

---

## [0.4.0] - 2026-03-30

> What changed since v0.3.0. For patch-level detail, see the v0.3.x entries below.

### Upgrading from v0.3.x (or earlier)

**Docker users:** Pull the new image and restart — data migrates automatically. A pre-upgrade backup is saved to `/data/pre-upgrade-backup-{timestamp}.json`.
**Self-hosted:** Run `pnpm db:migrate`. Your data is preserved.
**Restoring old backups:** v0.1.x, v0.2.x, and v0.3.x backup files all import seamlessly — they are auto-transformed to the current schema.

All v0.3.x migrations have been squashed into a single initial schema. The migration runner detects the squash automatically and handles the transition.

### Per-Person Retirement Engine

- **Staggered retirement ages** — each spouse can retire at a different age; the still-working spouse continues contributing while the retired spouse stops
- **Per-person Social Security** — each spouse's SS kicks in at their own claiming age with per-person breakdown in tooltips
- **Per-person RMDs** — computed from each spouse's birth year and individual Traditional account balances, following SECURE 2.0 rules
- **Per-person IRMAA** — Medicare surcharge correctly applies to each spouse independently when both are 65+
- RMD-based spending strategy now uses the primary person's actual age for the IRS factor lookup instead of the household average
- Timeline shows "Household Retirement" based on when the last person retires instead of a misleading average

### Brokerage Page Redesign

- **Single-page layout** — Goals section collapsed inline, "Planned Events" replaces separate Transactions tab
- **Detailed tooltips** on all Year-by-Year columns (contribution breakdown, growth, withdrawal tax cost, balance change)
- **Today's $ / Future $ toggle** with inflation-adjusted deflation
- **Budget linking badge** showing which budget item funds each brokerage account
- **YNAB account linking** — link brokerage accounts to YNAB tracking accounts; linked accounts use YNAB as the balance source of truth
- Portfolio snapshot import automatically pulls YNAB balances for linked accounts

### Post-Retirement Brokerage & Contribution Controls

- **Per-account "After retirement" setting** — stop contributions, continue until last person retires, or continue indefinitely
- **Per-account contribution scaling** — scales with salary (default) or fixed amount; prevents fixed-dollar contributions from dropping during staggered retirement
- Post-retirement brokerage contributions grow with limit growth rate (inflation) instead of staying flat

### Cost Basis Tracking

- **Per-account cost basis** on the Performance page Brokerage tab — editable field with computed unrealized gain column

### Override System

- **Wizard-style "Add Override" flow** — pick year, pick what to change, fill 1-3 fields; replaces three dense forms
- **Database persistence** — projection overrides (withdrawal rate, routing mode, account caps, Roth conversion targets, lump sums) survive page refresh
- **Lump sums target specific accounts** with shared form and badge components used by both retirement and brokerage pages
- Lump sums appear in the retirement projection table with In/Out column, contribution columns, and balance tooltips
- Override badges show type context ("Contribution" when from a profile, "Salary" when custom)
- Strategy-aware context banners explain how the active spending strategy interacts with withdrawal routing and overrides

### Portfolio Enhancements

- **Quick Look stats panel** — all-time high, distance from ATH, YTD and 52-week change, biggest gain/loss, current streak, volatility, and all-time growth
- **Change % column** in Snapshot History with color-coded positive/negative values and gap-since-last-snapshot context
- Snapshot History sorting now works across all data, not just the current page

### UI/UX

- Restructured retirement page: spending strategy, budget, and withdrawal rate grouped in a "Decumulation Plan" section
- Withdrawal Routing redesigned with compact collapsed view and sunken expanded panel
- Budget and withdrawal rate controls visually dimmed when the selected strategy doesn't use them
- Fixed 148 instances of missing spacing between variables and text across the app
- Softer, theme-aware card borders in both light and dark mode
- Upgraded to Next.js 16 with Turbopack for faster development builds
- "Recently Retired" demo profile with realistic account mix (401k, 403b, IRA, Roth, brokerage)

### Security & CI

- Hardened admin test runner against shell injection
- Health detail endpoint no longer reveals whether authentication is configured
- All CI checks now block merges — dependency audit, migration check, and docs freshness were previously advisory-only
- Hardened CI pipeline against supply chain attacks (pinned all dependencies to exact versions)
- Keyboard skip-to-content, focus trapping in dialogs, and screen reader error announcements
- Tightened Content Security Policy with Cross-Origin isolation headers
- Container runs with read-only filesystem, no Linux capabilities, and owner-only file permissions
- Docker image uses pinned, reproducible base image with canary deploy pattern

### Self-Hosting & Operations

- All v0.3.x migrations squashed into a single clean schema — new installs get one migration instead of seven
- Pre-upgrade auto-backup handles v0.1.x, v0.2.x, and v0.3.x databases
- Cross-version backup import supports all previous schema versions with auto-transforms
- SQLite squash upgrade support (same seamless upgrade path as PostgreSQL)

### Testing

- 2,750+ tests (up from 2,300+) covering budget API integrations, financial calculations, database compatibility, and backup round-trips
- Automated tax parameter staleness check in CI

### Bug Fixes

- First-year pro-rating now excludes the current month after mid-month
- Expense chart and table showed incorrect actual spending amounts (double unit conversion)
- Year-over-year comparison no longer shows $0 for the prior year
- Credit card payment transfers no longer appear as spending
- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values
- Fixed Docker build failure on Node.js 25

---

# v0.3

## [0.3.28] - 2026-03-30

### Added

- Brokerage page redesigned as single-page layout — Goals section collapsed inline, "Planned Events" replaces separate Transactions tab
- Year-by-Year brokerage table now has detailed tooltips on all columns (contribution breakdown, growth, withdrawal tax cost, balance change) using shared retirement tooltip infrastructure
- Today's $ / Future $ toggle on brokerage page with inflation-adjusted deflation
- Editable annual contribution increase control on brokerage Funding Sources card
- Budget linking badge ("Linked to budget: LT Brokerage") on brokerage By Account section
- Per-account "After retirement" setting on Portfolio page: stop contributions, continue until last person retires, or continue indefinitely
- Per-account "Contribution scaling" setting: scales with salary (default) or fixed amount — prevents fixed-dollar contributions from dropping during staggered retirement
- Per-account cost basis on Performance page Brokerage tab — editable field updated alongside other performance data, with computed unrealized gain column
- Brokerage contributions now continue after retirement for accounts set to "Continue indefinitely"

### Fixed

- First-year pro-rating now excludes the current month after mid-month (day > 15) — March 30 shows 9 months remaining, not 10
- Fixed-dollar brokerage contributions no longer drop during staggered retirement when one person retires
- Post-retirement brokerage contributions now grow with the limit growth rate (inflation) instead of staying flat
- Budget linking badge now resolves correctly — previously never matched because it compared display labels instead of raw category keys
- YNAB linking badge now resolves correctly for accounts that don't yet have a performance-account link
- Contribution account linking dropdown no longer hides budget items that are already linked to API categories
- Planned Events tooltip no longer incorrectly references IRS contribution limits (brokerage has none)

---

## [0.3.27] - 2026-03-30

### Added

- Brokerage accounts can now be linked to YNAB tracking accounts — linked accounts use YNAB as the balance source of truth
- New "Account Linking" section on the brokerage page with link/unlink controls and YNAB badges
- Portfolio snapshot import automatically pulls YNAB balances for linked accounts before pushing

### Improved

- Consolidated the brokerage page from 3 tabs to 2: removed "Transactions" tab, renamed "Lump Sum Events" to "Planned Events"
- Planned Events now use the same engine-integrated lump sum system as the retirement page instead of a separate goal-linked transaction system

---

## [0.3.26] - 2026-03-30

### Fixed

- Timeline now shows "Household Retirement: X when last person retires" instead of misleading "Avg Retirement Age" — matches the engine's actual per-person retirement behavior

---

## [0.3.25] - 2026-03-30

### Improved

- Override edit now works: pencil icon opens wizard at step 3 with value pre-filled
- Salary/contribution overrides support "From contribution profile" with profile selector
- Budget overrides support "From budget profile" with profile + column selector
- "Salary Change" renamed to "Contribution / Salary" to reflect full scope
- Override badges show "Contribution" when from a profile, "Salary" when custom

---

## [0.3.24] - 2026-03-30

### Improved

- Redesigned overrides panel: wizard-style "Add Override" flow replaces three dense forms — pick year, pick what to change, fill 1-3 fields
- Saved overrides display as clean scannable cards with year, type badge, and summary
- Withdrawal Routing section redesigned to match: indigo buttons, compact collapsed view, sunken expanded panel
- Strategy-aware context banners explain how the active spending strategy interacts with withdrawal routing and overrides
- Removed verbose "Deterministic + MC" badges from all Projection Assumptions sections — cleaner headers

---

## [0.3.23] - 2026-03-30

### Added

- Lump sums now target specific individual accounts (e.g., "Retirement Brokerage (Vanguard)") instead of account categories
- Shared lump sum form and badge components used by both retirement and brokerage pages
- Brokerage page lump sums now persist to database and support both injections and withdrawals
- Lump sums appear in the retirement projection table: In/Out column (net), contribution columns, and balance tooltips

### Improved

- Override sections renamed from "Saving/Withdrawal" to "Pre-Retirement/Post-Retirement" for clarity

---

## [0.3.22] - 2026-03-29

### Fixed

- Lump sums added for post-retirement years now correctly route to the decumulation engine instead of silently being ignored
- Overrides are now editable — click the pencil icon on any override badge to populate the form for editing

---

## [0.3.21] - 2026-03-29

### Added

- Projection overrides (withdrawal rate changes, routing mode, account caps, Roth conversion targets, lump sums) now persist to the database — no longer lost on page refresh

---

## [0.3.20] - 2026-03-29

### Improved

- Restructured retirement page: spending strategy, budget, and withdrawal rate are now grouped together in a "Decumulation Plan" section instead of scattered across the page
- Budget and withdrawal rate controls are visually dimmed with an explanation when the selected strategy doesn't use them (e.g., RMD-Based computes spending from portfolio, not budget)
- Withdrawal Rate label changes contextually: "Initial Withdrawal Rate" for dynamic strategies, "Withdrawal Rate" for fixed
- Withdrawal-related labels across 6 locations now explain how dynamic strategies override the base rate
- Fixed 148 instances of missing spaces between variables and text across 32 files

### Added

- "Quick Look" stats panel on the Portfolio page — toggle button reveals all-time high, distance from ATH, YTD and 52-week change, biggest gain/loss, current streak, average change, best/worst month, volatility, and all-time growth

---

## [0.3.19] - 2026-03-29

### Added

- "Gap" column in Snapshot History showing days since the previous snapshot — provides context when sorting by Change or Change %

---

## [0.3.18] - 2026-03-29

### Fixed

- Snapshot History sorting and change calculations now work across all data, not just the current page — sorting by Change or Change % produces correct global results
- First snapshot on each page no longer shows "—" for Change — delta is computed against the chronologically previous snapshot regardless of pagination

---

## [0.3.17] - 2026-03-29

### Added

- Sortable "Change %" column in Snapshot History showing week-over-week percentage change with color-coded positive/negative values

---

## [0.3.16] - 2026-03-29

### Fixed

- Corrected Social Security amounts in recently-retired demo profile from $3,500/$1,800 to $2,000/$2,000 per month

---

## [0.3.15] - 2026-03-29

### Fixed

- RMD-based spending strategy now uses the primary person's actual age for the IRS factor lookup instead of the household average — eliminates a gap year with $0 withdrawals in multi-person households

---

## [0.3.14] - 2026-03-28

### Added

- Staggered retirement ages: each spouse can retire at a different age — the still-working spouse continues contributing while the retired spouse's contributions automatically stop
- Household transitions to full decumulation only when the last person retires

---

## [0.3.13] - 2026-03-28

### Fixed

- IRMAA Medicare surcharge now correctly applies per-person — when both spouses are 65+, each pays their own surcharge instead of charging only once

---

## [0.3.12] - 2026-03-28

### Added

- RMDs are now computed per-person based on each spouse's birth year and individual Traditional account balances
- James (born 1959) starts RMDs at age 73; Patricia (born 1961) starts at age 75 — each correctly follows SECURE 2.0 rules
- Per-person RMD breakdown available in engine output for tooltip display

---

## [0.3.11] - 2026-03-28

### Fixed

- "Nest Egg at Retirement" now shows current portfolio value for already-retired users instead of $0
- Sustainable withdrawal amount now correctly uses current balance when already retired

### Added

- Social Security income is now modeled per-person — each spouse's SS kicks in at their own claiming age instead of using only the primary person's values
- Withdrawal tooltips show per-person SS breakdown (e.g., "James: $42,000, Patricia: $21,600")

---

## [0.3.10] - 2026-03-28

### Improved

- Retirement table rows now highlight the year Social Security begins (teal) and when RMDs start (amber)
- Hovering over withdrawal amounts shows SS income and RMD context directly in the table tooltip

---

## [0.3.9] - 2026-03-28

### Improved

- Retirement projection chart now explains why withdrawal amounts change at key ages — tooltip shows when Social Security begins and when RMDs kick in
- Dashed reference lines on the chart mark Social Security and RMD start ages for at-a-glance context
- "Recently Retired" demo profile now shows a realistic mix of account types (401k, 403b, IRA, Roth, brokerage) instead of IRAs only

---

## [0.3.8] - 2026-03-27

### Added

- New "Recently Retired" demo profile — a couple in their late 60s with $5M portfolio, RMD-based withdrawals, and Social Security delayed to age 70
- Backup files exported from one version now round-trip back through import without data loss, including across schema upgrades

---

## [0.3.7] - 2026-03-26

### Fixed

- Expense chart and table showed wildly incorrect actual spending amounts (values were 1,000× too small due to a double unit conversion)
- Expense budgeted column now uses the same YNAB data source as actuals — budget-vs-actual comparisons are apples-to-apples
- Year-over-year comparison no longer shows $0 for the prior year — transaction sync now fetches enough history
- Credit card payment transfers no longer appear as spending in the expense breakdown
- Chart tooltip no longer labels both bars as "Actual" — budgeted and actual are now correctly distinguished
- YNAB system categories (Split, Inflow, Uncategorized) no longer inflate expense totals in the year-over-year table

---

## [0.3.6] - 2026-03-26

### Security

- Hardened admin test runner against shell injection
- Health detail endpoint no longer reveals whether authentication is configured — all auth failures return the same response

### Fixed

- Savings goals with a parent can no longer reference a non-existent goal (database constraint added)
- Financial amount fields now reject invalid values like "NaN" or empty strings on save

### Improved

- Keyboard users can skip directly to page content without tabbing through the sidebar
- Focus stays trapped inside slide panels and confirmation dialogs — Tab no longer escapes to background content
- Screen readers now announce which input has an error and read the error message
- Sortable table columns announce their current sort direction to screen readers

---

## [0.3.5] - 2026-03-25

### Fixed

- Corrected 5 incorrect 2025 IRS contribution limits that were using 2026 values:
  - 401k employee limit: $24,500 → $23,500
  - 401k catch-up limit: $8,000 → $7,500
  - IRA limit: $7,500 → $7,000
  - HSA family limit: $8,750 → $8,550
  - HSA individual limit: $4,400 → $4,300

### Improved

- Split large projection page into smaller, faster-loading sections
- All CI checks now block merges — dependency audit, migration check, and docs freshness were previously advisory-only
- Hardened CI pipeline against supply chain attacks (pinned all dependencies to exact versions)
- Added 400+ new tests (2,700+ total) covering budget API integrations, financial calculations, and database compatibility

---

## [0.3.4] - 2026-03-25

### Fixed

- Fixed visual glitch where card borders appeared as harsh white/black lines — borders now use softer, theme-aware colors in both light and dark mode
- Fixed a bug where clicking a budget profile could trigger two actions at once (nested button hydration error)
- Fixed 6 cases where list items (savings goals, projections, upcoming goals) could flicker or reorder incorrectly due to unstable keys

### Improved

- Upgraded internal routing to Next.js 16 conventions (no user-facing changes)

---

## [0.3.3] - 2026-03-25

### Improved

- Faster calculations across performance, contributions, portfolio, tax, historical, and projection pages — core math extracted into optimized modules
- Fixed a timezone bug that could show salary changes on the wrong date

### Fixed

- Fixed Docker build failure on Node.js 25

---

## [0.3.2] - 2026-03-25

### Security

- Tightened Content Security Policy — removed unsafe script evaluation, added object/base-uri restrictions
- Added Cross-Origin isolation headers for stronger browser-side protection
- Container now runs with read-only filesystem, no Linux capabilities, and owner-only file permissions
- Health endpoint split: basic probe at `/api/health`, detailed diagnostics require authentication

### Improved

- Docker image now uses a pinned, reproducible base image with OCI provenance labels
- Production image is smaller — removed TypeScript compiler from runtime
- New deploy script with canary pattern: demo container is health-checked before production rolls over
- Rollback support: previous image versions are preserved as `ledgr:X.Y.Z` tags
- CI runs ~45 seconds faster with browser and build caching
- Stale CI runs are automatically cancelled when new commits are pushed

---

## [0.3.1] - 2026-03-25

### Improved

- Upgraded to Next.js 16 with Turbopack for faster development builds
- Resolved a transitive dependency vulnerability (flatted CVE)
- Zero production vulnerabilities enforced in CI

### Fixed

- Fixed a bug where editing settings could trigger side effects twice in development mode
- Fixed incorrect import restrictions that blocked valid server-side code

---

## [0.3.0] - 2026-03-24

> What changed since v0.2.0. For patch-level detail, see the entries above.

### Security

- Upgraded to Next.js 15 and React 19, resolving all known Next.js 14 CVEs including a critical (CVSS 10.0) remote code execution vulnerability

### Improved

- Upgraded to Node.js 24 LTS — extends support through April 2028

---

# v0.2

## [0.2.1] - 2026-03-24

### Improved

- Upgraded to Node.js 24 LTS (from Node 20) — extends support through April 2028

---

## [0.2.0] - 2026-03-24

> Everything that changed since v0.1.0. For patch-level detail, see the
> v0.2.1 entry above.

### Upgrading from v0.1.x

**Docker users:** Pull the new image and restart — data migrates automatically.
**Self-hosted:** Run `pnpm db:migrate`. Your data is preserved.
**Restoring old backups:** v0.1.x backup files import seamlessly — they are
auto-transformed to the current schema.

### New Pages & Features

- **Contributions page** — household contribution analysis with savings rate summary, per-person account breakdown, employer match analysis, traditional vs Roth split, and contribution profile comparison
- **Help & Guide page** — walkthrough of every feature organized by section
- **Raw Data Browser** — admin-only live database table viewer with row counts, column metadata, paginated data, and JSON export
- **Assets page** — consolidated breakdown with Cash, Property, Other Assets groupings and subtotals

### Retirement & Projections

- **Lump-sum injections** — model one-time events (bonus, inheritance, windfall, rollover) in any projection year
- **Per-year contribution profile switching** — change your contribution structure at a future year (job change, ESPP stop, etc.)
- **Configurable filing status** — MFJ/Single/HOH as explicit retirement setting; affects federal brackets, LTCG, IRMAA, Social Security, and NIIT
- **Snapshot selector** — run projections from any historical portfolio snapshot, not just the latest
- **Monte Carlo success rates** — withdrawal strategy comparison table now shows success rate per strategy
- **LTCG progressive stacking** — capital gains now taxed across 0%/15%/20% brackets by stacking on top of ordinary income (was flat rate)
- **NIIT surtax** — Net Investment Income Tax on income exceeding $200k/$250k thresholds
- **LTCG and IRMAA brackets in database** — rates versioned by year and filing status (no more hardcoded values)

### Contributions & Paycheck

- **Prior-year tax contributions** — designate IRA/HSA contributions for the prior tax year during the IRS window (Jan 1 - Apr 15)
- **Multiple contribution profiles** — switch profiles from the top bar; view without activating
- **Budget-linked profiles** — each budget column links to a contribution profile; savings page uses the correct one automatically

### Budget & Savings

- **Budget mode awareness on savings** — savings page derives contribution profile from budget column link; cross-mode capacity comparison shows max monthly funding per budget column

### Portfolio & Performance

- **Performance tab groups** — split into "By Account" and "Rollup" views
- **Rollovers column** — separates internal transfers from actual contributions in the performance table
- **YTD timeframe** — portfolio chart now has a "YTD" button
- **Hover comparison line** — horizontal reference line on portfolio chart

### Integration & Sync

- **YNAB key update** — replace API key without removing the connection
- **Savings sync** — pushes monthly contributions from Ledgr to YNAB goal targets instead of pulling balances

### Self-Hosting & Operations

- **Dual database support** — SQLite (zero-config default) or PostgreSQL
- **CLI backup tools** — `pnpm backup:export` and `pnpm backup:import` for headless environments
- **Pre-upgrade auto-backup** — automatic snapshot before schema changes
- **Cross-version backup import** — old v0.1.x backups auto-transform on import
- All 9 migrations squashed into a single clean schema — new installs get one migration instead of nine
- Release automation via `pnpm release X.Y.Z`
- Node.js 24 LTS — extended support through April 2028

### UI/UX

- **Sidebar redesign** — reorganized into Cash Flow / Wealth / Net Worth / Analysis / System
- **Theme support** — semantic design tokens throughout

### Security

- Column name validation on backup import prevents SQL injection via crafted files
- Rate limiting on Monte Carlo and sync endpoints (5 req/min)
- Password complexity enforced for local admin accounts
- Database error details removed from health endpoint; PostgreSQL port bound to localhost

### Testing & CI

- 2,300+ automated tests covering financial calculators, server logic, and backup round-trips
- 26 E2E Playwright smoke tests for all dashboard pages
- Coverage thresholds enforced (statements 85%, branches 70%, functions 80%, lines 85%)
- Dependabot auto-merge for minor/patch updates after CI passes

### Bug Fixes

- Fixed LTCG bracket stacking (was flat rate, now progressive)
- Fixed contribution override double-inflation on profile switches
- Fixed ESPP/account persistence after contribution profile override
- Fixed overflow routing fallback for joint brokerage
- Fixed rollup contribution mismatch with cross-category rollovers
- Fixed emergency fund self-loan calculation
- Fixed timezone display for database timestamps

---

# v0.1

## [0.1.0] - 2026-03-18

Initial release.

- 7 withdrawal strategies (Fixed, Forgo-Inflation, Spending Decline,
  Constant %, Endowment, Vanguard Dynamic, Guyton-Klinger)
- Federal tax engine with 2025/2026 brackets, FICA, Additional Medicare Tax
- Social Security taxation using the IRS provisional income formula
- Required Minimum Distribution tracking with SECURE 2.0 age thresholds
- Monte Carlo retirement simulations with correlated returns and percentile bands
- IRMAA cliff detection with 2-year lookback
- Mortgage calculator with amortization, extra payments, refinance chains,
  and what-if scenarios
- Contribution routing with waterfall, percentage, and spec-based modes
  (IRS limits enforced)
- Budget dashboard with income/expense tracking and category breakdowns
- Savings goals tracking
- Brokerage account management with performance metrics
- Portfolio allocation and rebalancing views
- Paycheck modeling with pre-tax/post-tax deduction breakdowns
- Side-by-side scenario comparison
- State versioning with snapshot/restore and JSON export/import
- Demo mode with pre-built profiles and read-only access
- ACA subsidy estimator
- Role-based access via Authentik OIDC with granular permissions
- Dark and light themes
- PostgreSQL with Drizzle ORM and automated migrations
