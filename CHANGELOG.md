# Changelog

All notable changes to Ledgr will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

# v0.10

## [0.10.2] - 2026-11-06

v0.10.2 gives every piece of code one home by what it does: pure calculations in `lib/pure/<area>/`, shared database reads in `server/data/`, and composition that needs the database in `server/services/`, with the largest routers split by concept. The test that records every figure the app shows stays identical through every change in this release. Two behaviours change: Actual uses its Server URL as saved in Settings, and a SimpleFIN account re-added under a new id keeps its row instead of counting twice (below). Two more things change for self-hosters: every outside request is now checked when it is sent, and four data migrations run at start-up.

### Upgrading

- **Take a database dump before upgrading.** The start still writes its own pre-upgrade backup; the dump is what a rollback restores.
- **To roll back, restore the pre-upgrade database dump; never swap the image back.** The v0.10.1 image can't run on a database v0.10.2 has migrated, and it can't restore a backup taken on v0.10.2, so anything changed after the upgrade is lost on rollback. From v0.10.2 on, a database a newer Ledgr upgraded is refused with a message instead of rewritten.
- **The first Simulation load after upgrading is slow, once.** The engine's code changed, so cached projections and Simulation runs are rebuilt the first time they're opened. This is not a regression; later loads are as fast as before.
- **Four migrations run at start-up:** 0014 moves a contribution account's custom name from its old stored key (`displayNameActive`) to `displayNameCustom`; 0015 drops the holding history's never-written performance link and ten settings no version of Ledgr used; 0016 adds the employer match rate as a fraction (50% is stored as 0.5); and 0017 finishes that move: where 0016 stored a rate, the old whole-percent value is cleared, so the rate is the only copy. A dollar or fixed-annual profile override that had no amount of its own first gets the amount it was using, and a value 0016 couldn't convert is kept and read as before. Each runs again cleanly, and restoring an older backup runs them in order.
- **A profile's own percent match no longer follows a dollar account.** If a Contribution Profile sets its own percent match on an account whose match is in dollars, the profile now keeps the percent it read when you upgraded (or when you last edited that profile): a later change to the account's dollar amount no longer changes the profile's percent, so set the profile's match again if you want it to follow.
- **API:** contribution accounts and profile entries now return `employerMatchRate`, and `employerMatchValue` is empty on percent matches. A percent match above 200% is refused when it is set.

### Fixed

- **Re-adding an institution in SimpleFIN keeps each account's links and history.** SimpleFIN gives a re-added institution's accounts new ids; Ledgr used to add them as new, unlinked accounts beside the old ones, so their money counted twice. Now an account keeps its row, links and history once its old id has gone unreported for a day, and a duplicate already created is merged on the next sync after that. Anything Ledgr can't pair one to one (two accounts with the same name, a renamed account) is left alone; you can merge it yourself from SimpleFIN settings, right away, where a new account offers "Looks like a re-added account: merge into …?".

### Safer outside requests

- **One checked fetch** for YNAB, Actual, SimpleFIN, Tiingo and SEC. Actual uses its Server URL as saved in Settings (by anyone with the sync permission), LAN addresses, Docker service names and `.local` names included. YNAB, SimpleFIN, Tiingo and SEC are checked to be public both when a request is sent and at the address actually connected, so a DNS name that points at the LAN, or one that changes between the check and the connection, is refused. **SimpleFIN and Tiingo now refuse `http` URLs.**
- **Redirects**, for every service, go at most three hops, and only to the same origin or from `http` to `https` on the same host, so a credential header never reaches another host. No error message includes a response body or a URL's user name and password.

### Migrations and backups

- **The migrator refuses what it can't upgrade safely, with nothing changed:** a database a newer Ledgr upgraded is told to restore its backup or run the newer image, and a database at no known release's schema is told to restore, not to install v0.8.15.
- **SQLite migrations run with foreign keys off and check them before commit,** so a table rebuild can never delete another table's rows through a cascade; a replayed rebuild runs as one unit and keeps a newer release's column.
- **Data conversions run inside their migration,** in the normal path, both squash replays and the restore of an older backup, and each writes only where its value is still empty, so it never converts twice.
- The migrator imports the code it used to carry pasted copies of, and its migration list comes from the journal.

### Under the hood

- **One home per kind of code.** The calculators and the projection engine moved from `lib/calculators/` to `lib/pure/<area>/`, their types beside each calculator; `server/helpers/` is gone, its reads now in `server/data/` and its composition in `server/services/<area>/`. Routers no longer import functions from other routers.
- **Big routers split by concept:** savings, budget, performance, net worth, retirement, sync, SimpleFIN and the paycheck settings, each into a folder of parts, one concept each.
- **Shared composition gets one path:** the paycheck, contribution, savings and budget summaries, the milestone inputs, profile create, duplicate, delete and switch, and every projection procedure's run set-up each live in one service that every caller uses, so their figures can't drift apart. Each request shares one read of the people across its summaries.
- **The dashboard's Retirement tile** reads a small Simulation summary (about 1–5 KB) instead of the full result (up to 360 KB); its figures are the same.
- **Demo:** the demo schema build accepts only a known demo profile, and every demo profile fills what its pages read.
- **Guards and CI:** every `src/server/` file belongs to a declared layer; ratchets and the behaviour baseline are checked against the merge base; commit rules run on push; the gate runs the type-aware lint; CI runs in parallel jobs with sharded tests, and a docs-only push skips the heavy steps.
- **The calculation register** covers `lib/pure` only, and names seven more of its functions, with a new row for other liabilities.

Counts: functions over 150 lines 304 → 299; lint suppressions 4,550 → 4,441; type-aware lint suppressions 698 → 688; `src/` 862 lines larger.

## [0.10.1] - 2026-11-04

v0.10.1 reshapes how Ledgr's code knows things: each domain fact now has one definition that the rest of the code reads, instead of copies that can drift apart. No figure in the app changes; a test records every figure the app shows and stays identical through every change in this release.

### Upgrading

- **Pull the new image and restart.** No database changes.
- **The first projection after the upgrade recomputes.** Cached projections and Simulation runs are now keyed by the code that computes them, so every release that changes that code starts with fresh results once. A Simulation's median can differ slightly from the last cached run (a new random draw), and the dashboard tile shows the projection's figure until the Retirement page runs the Simulation again.
- **A filing status Ledgr doesn't recognise now stops the projection with an error** instead of computing with no withholding table. Ledgr only ever saves MFJ, Single or HOH, so this can only come from a hand-edited database or a restored backup with a bad value; fix the status on the Retirement Profile or the Taxes page.

### Under the hood

- **Lists defined once.** Account types, filing statuses, tax treatments, budget apps, pay periods, dollar views and permissions are each declared in one place and read everywhere; adding an account type no longer means editing hand-written copies of its list (a test adds a made-up type and checks it reaches the projection, Tax Buckets and every derived list).
- **Filing status and ages:** the W-4 box and this year's return are separate types, and the W-4 stands in for the return in one named place. Age rules (catch-up, 65+, QCD, Medicare) live in one table with today's measures.
- **One year's income and MAGI:** the projection reads income streams and each rule's MAGI (IRMAA, ACA, NIIT, senior deduction) from one definition.
- **Contributions:** one yearly-amount function, one percent conversion, and three named states for a year's saving (contributing, paused, stopped) in place of a 0 that meant all three.
- **Requests:** each request reads "now" once, and the projection and budget procedures take one profile selection instead of per-page tier objects.
- **Budget apps:** YNAB and Actual are entries in one registry, and one test suite runs against both.
- **Guards:** a new hand-written copy of a closed list, or a new plain-text field for an account type, category, tax type or filing status, now fails CI; commit rules (prefix, reason, size) block instead of warn.

Counts: functions over 150 lines 306 → 304; lint suppressions 4,511 → 4,550 (4,367 without the 183 plain-text fields the new guard counts, so −144); `src/` 1,537 lines smaller.

## [0.10.0] - 2026-11-03

> Rollup of everything since v0.9.0. For patch-level detail, see the v0.9.x entries below.

v0.10.0's own work is structure: checks that stop the code from drifting, a test that records every figure the app shows, and unused features removed. No figure in the app changed in v0.10.0 itself; the figure changes below came in v0.9.1–v0.9.10.

### Upgrading from v0.9.x

- **Pull the new image and restart.** v0.10.0 itself has no database changes. Coming from an earlier v0.9.x, the start applies the migrations from v0.9.2–v0.9.7 that you don't have yet, after its usual pre-upgrade backup. It upgrades from any v0.9.x.
- **Self-hosting with the sample Docker Compose files:** your settings file must set `NEXTAUTH_SECRET`, `CRON_SECRET` and `ENCRYPTION_KEY` (and `POSTGRES_PASSWORD` for PostgreSQL). Ledgr refuses to start and names the one that's missing.
- **Behind a reverse proxy that doesn't set the visitor's real address, or with no proxy,** set `TRUSTED_PROXY_HEADER` so sign-in and rate limits see each visitor's real address.
- **Rotate your budget and market-data keys** if you ran a version before v0.9.5: until then the change log stored saved API keys and tokens in plain text. The upgrade scrubs them, but rotate the Actual and Tiingo keys and revoke any YNAB token you connected.
- **Expect retirement figures to move** if you're coming from v0.9.4 or earlier: Social Security now grows with inflation and its taxable share is taxed, each person's RMD, raise and ages are their own, years with one paycheck draw from your accounts, and the Simulation follows your own inflation. The sections below say how.

### Installing and signing in

- **The sample Docker Compose install starts, signs in and runs with no extra setup.** A new install offers "Create the first admin" on the sign-in page, then opens the setup wizard; finish it before you expose Ledgr publicly. Local admin is the default sign-in and Authentik is optional.
- **Ledgr ships its Simulation presets** (Default, Aggressive, Conservative), so a new install, a reset and the demo can run the Simulation; installs that already have presets keep theirs. A new install also gets its first Retirement profile the first time you save retirement settings, so "Save as a new Plan" works.
- **When something can't run, it says why:** the Simulation names what's missing instead of reporting "unreachable", projections ask for a return rate first, and "Save as a new Plan" says why it's disabled.
- One disclaimer on every advice and projection page; "Print Advisor Report" is now **"Print Full Report"**.
- A new install and operations guide in the docs covers installing, backups, upgrading and rolling back.

### Retirement projections

- **Each person is their own person.** The plan runs from each person's own age and retirement date instead of the couple's average age, and reads in years (hover a year for everyone's age). Each person's RMD comes from their own accounts on the year-end balance, each salary grows at its own raise rate, and the employer match follows the pay of the person whose account gets it.
- **Years with one paycheck.** When one person retires first or a job ends early, you choose whether to keep saving and whether to withdraw what pay doesn't cover; the projection marks those years. Jobs count from their start date to their end date, and contributions get catch-up room as people age (from 50, the larger one at 60–63).
- **Social Security gets its cost-of-living raise, and its tax is charged.** Benefits grow with your inflation rate, the taxable share is taxed (counting brokerage gains and taxable Roth growth, as the IRS formula does), and the projection table shows that tax on its own line.
- **New spending strategy: Variable Percentage Withdrawal (VPW)**, matching the published table. Constant Percentage, Endowment, Vanguard Dynamic, RMD Spending and VPW each have a switch for whether Social Security comes out of the amount or on top of it; older profiles keep their behaviour.
- **The mortgage ends in the projection** — pick the budget line that pays it and spending drops the year after payoff.
- **A bracket target is a preference, not a spending limit:** withdrawals go past it to fund your spending and say so; your own caps stay hard.
- Guyton-Klinger judges the portfolio's own withdrawal rate (spending less Social Security) and carries through years Social Security covers. Withdrawals never take the whole balance to cover taxes; a year's 0% contribution rate pauses contributions; Roth basis at retirement reflects gap-year draws; dozens more two-person, RMD, QCD and HSA fixes.

### The Simulation

- **It follows your inflation.** Trials vary around your own inflation and post-retirement raise (keeping your gap between them), inflation varies year by year inside each trial, and each trial's today's dollars use the inflation it ran with.
- **Presets mean the same thing everywhere:** the preset you pick sets both the Simulation and the strategy comparison, and Coast FIRE uses the same returns and limits.
- The projection chart's tooltip shows each year's assumptions (plan return, the Simulation's return and spread, inflation, Guyton-Klinger's anchor).

### Taxes and paychecks

- **This year's tax return has its own filing status** (Taxes page), separate from a Retirement Profile's. A profile can be set to Auto to follow it, and with nothing set Ledgr assumes Single rather than married filing jointly. The Roth IRA check and household tax use it, not the W-4.
- **Paychecks match payroll more closely:** a bonus is withheld at 22% on its taxable amount, Additional Medicare shows on each check past $200,000, a job started this year is paid from its start date, and the pay-stub check compares bonus checks.
- **Two tax tables held the wrong year's figures** (2025 capital-gains brackets and 2026 IRMAA brackets) and are corrected; a figure you changed yourself stays yours.
- **Every tax figure links to its source document**, tax data is one file per year with contributor tooling, and new years are checked strictly: a table identical to last year's is rejected as an unupdated copy.
- **The answer key:** about 650 test cases worked by hand from IRS, SSA, CMS and HHS publications, and a public register of every calculation Ledgr does with its source and known gaps. Cases Ledgr gets wrong today are recorded with the correct figure for a later fix.

### Budget-app and data-feed sync

- **Ledgr checks what Actual, YNAB, SimpleFIN, SEC and Tiingo send before using it.** A broken or changed answer used to be stored as $0 or blank — a debt shown as paid off, a balance zeroed — with the sync reporting success. Now the sync stops, nothing changes, and you're told what was wrong. Failed syncs and pushes say what happened and what was written.
- **Actual transactions carry their category and payee names**, so Expense year-over-year fills in on Actual, and testing an Actual connection really asks Actual.
- **Debts can follow a budget account**, and a mortgage servicer's SimpleFIN feed can be your loan's balance. One budget account can't be counted in two places.
- **Budget targets follow one rule in every integration:** a monthly push replaces only a monthly target; others are left alone and reported as skipped.
- **Market prices are kept in the database**, so each close is fetched once and Tiingo is asked far less; fund history keeps every sync.
- Many SimpleFIN, snapshot-push and goal-push fixes: partial failures no longer leave half-written results, pending transactions aren't counted twice, and one unreadable account no longer stops the others.

### Insights

- **Current Balances replaces the Live Balance card**: the most accurate figure per account, moved to the latest market close, with daily movement from each fund's own price change and money paid in or out shown beside it.
- **New milestones:** "Save your raises (60/40)", "Always Be Buying", Money Guy's 20/3/8 car rule and student loans against first-year pay. Milestones remember when they were first reached, and your own goals can count invested money without cash.
- **Milestones, Recommendations and Benchmarks read as one set**, recommendations lead with one line saying what to do, and your plan is shown where it's used (Net Worth, Benchmarks, Budget, Contributions, the mortgage).
- Benchmarks shows what fund costs take from your balance over 10, 20 and 30 years; Money Guy's Goldilocks rule paces large lump sums; the high-income line follows your filing status and can be set.

### Keeping your records straight

- Finalizing a year works on SQLite, Performance's lifetime totals keep their history, past dates use the loan's schedule, and savings transfers stay paired.
- Deleting a person, account, debt or profile cleans up what pointed at it, and "Reset all data" clears the settings that pointed at the wiped data.

### Removed

- **The Settings → API tab.** It listed the server's internal calls for admins; the same list is in the project's documentation. If it was your saved tab, Settings opens on General.
- **The in-app test runner** (Settings → Debug). It could never run in the Docker image, which ships no tests; the Diagnostics switch stays.
- **The 30- and 90-day balance change** behind the old Live Balance card. No screen has shown it since Current Balances replaced that card in v0.9.5, so nothing on screen changes.

### Security

- Saved credentials no longer land in the change log (and old entries are scrubbed); backup previews need the Backups permission and never show credentials.
- Failed local-admin sign-ins are rate-limited, two people can't both create the first admin, restoring or resetting can't reopen "Create the first admin", Dev Login exists only in development builds, and rate limits use the address the proxy saw.
- The scheduled-job endpoints share one secret check and refuse anything but a valid secret.
- The container runs on Node.js 26.13.0.

### Under the hood

- **Your figures can't move by accident.** Every figure the app shows is recorded for 17 sample households, on SQLite and on PostgreSQL, along with the rows a YNAB or Actual sync writes and a fixed Simulation run. A change that moves any of them is stopped before release.
- **PostgreSQL is tested on every change**, as SQLite already was: installing from empty, upgrading, backup and restore, and the same figures as SQLite.
- **The sample Docker Compose install is tested on every change:** it must start on an empty volume and let a first admin sign in, on both databases.
- **Nothing is deployed without passing all of that.** Code-quality checks only ever tighten: file sizes, rule exceptions and the boundaries between parts of the app can't grow, and every calculation must be listed with its source.
- Unused code was removed and the oldest changelog entries (v0.7.11 and earlier) moved to their own file in the docs.

---

# v0.9

## [0.9.10] - 2026-11-03

The answer key: about 650 test cases worked by hand from the IRS, SSA, CMS and HHS publications, each with its working and source beside it, and `docs/CALCULATIONS.md`, the register of every calculation Ledgr does. No figure in the app changed.

### Added

- **The answer key** (`tests/**/answer-key-*.test.ts`), by area: tax 75 passing / 24 expected failures; paycheck 26 / 19; contribution limits 84 / 13; retirement rules 112 / 20; engine 7 / 20; spending strategies 45 / 14; Simulation 9 / 6; household math 62 / 10. A case Ledgr gets right today guards against regressions. A case it gets wrong is an expected failure holding the correct figure, naming the v0.11 item that fixes it, with today's figure pinned beside it. About 100 cases Ledgr can't take yet (an input it has no field for, or a function that doesn't exist) are listed as to-dos.
- **Published-table checks:** every shipped tax table cell for 2025 and 2026 (brackets, standard deductions and the 65+ add-on, capital-gains thresholds, Pub 15-T withholding), every IRMAA cell, the poverty guidelines for households of 1 to 8, and all 49 cells of the RMD Uniform Lifetime table are compared with figures typed in separately from the publications (`tests/fixtures/irs-published/`). CI fails for a shipped tax year without them.
- **`docs/CALCULATIONS.md`:** 271 calculations, each with its function, the law or source it follows, its tests, which answer-key cases cover it (generated from the test titles, kept current by `pnpm docs:update`) and its known gaps. Every row that follows tax law records the tax year it was last checked against the law.

### Changed

- **Tax-data files are checked more strictly** (`pnpm tax-data:check`, CI, and community tax-data updates). A table that's identical to the prior year's (withholding, capital gains, IRMAA thresholds or surcharges, poverty guidelines) is rejected as a copy not yet updated. A section's `exception` now counts only when it's the year's own, or when it carries through a repeat or jump that lasted several years; one copied along with a whole file doesn't. The shipped files pass unchanged; a tax year that really repeats a table needs an exception with its reason and source.
- **A new tax year needs a law check, not just new figures.** CI fails a new year's tax-data file until every tax-law row in `docs/CALCULATIONS.md` is checked for that year and the year has hand-worked whole-return cases for each filing status. `pnpm tax-data:new-year` also writes the blank published-figures file to fill in. Steps in `tax-data/README.md`.
- Mislabelled and weak tests fixed (a "2026 wage base" test that checked 2025's, a "no warning" test that asserted a warning, withholding checked only as "over $600", a cost-ranking test on a bracket table one row off). No app behaviour changed.

## [0.9.9] - 2026-11-03

Fresh installs and integrations: the sample Docker Compose install starts, signs in and saves a Plan with no extra setup, the Simulation runs on a new install, and Actual budgets get their category and payee names.

### Upgrading

- **Self-hosting with the sample compose files:** your `.env` must set `NEXTAUTH_SECRET`, `CRON_SECRET` and `ENCRYPTION_KEY` (and `POSTGRES_PASSWORD` for the PostgreSQL file). Compose now refuses to start and names the one that's missing, and passes every other variable in `.env` to Ledgr. `pnpm setup` fills the secrets for you.
- **Behind a reverse proxy other than one that overwrites `X-Real-IP`** (or with no proxy at all), set `TRUSTED_PROXY_HEADER` so sign-in limits and rate limits see each visitor's real address. Leaving it unset keeps today's behaviour.

### Added

- **Create the first admin from the sign-in page.** A new install shows "Create the first admin" until one exists, then signs you in and opens the setup wizard. Finish this before you expose Ledgr publicly: whoever reaches a new install first becomes its admin.
- **Ledgr ships its Simulation presets** (Default, Aggressive and Conservative, with their asset classes and how holdings count toward them). A new install, a "Reset all data" and the demo run the Simulation and simulated Coast FIRE on them. Installs that already have presets keep theirs exactly, so their figures don't change.
- **A new install gets its first Retirement profile, "Current Retirement",** the first time you save retirement settings, so "Save as a new Plan" works. An install that saved retirement settings before this release is set up the same way on its next save.
- **One disclaimer on every advice and projection page:** "Estimates from the figures and assumptions you entered. Not financial, tax or legal advice." (Recommendations, Milestones, the Checkup, Plan Health, Retirement, the claiming-age explorer and the printed report).

### Changed

- **Local admin is the default sign-in.** Authentik is optional: without it, the sign-in page offers the local admin form only, and the Authentik button shows only when Authentik is configured on the running install (it used to depend on how the image was built).
- **Failed local-admin sign-ins are limited:** after 5 failed attempts from one address, or 10 for one email, that address or email waits up to 15 minutes. A successful sign-in clears the count.
- **When the Simulation can't run, it says why** (no presets, no asset classes, no glide path, or a glide path that doesn't add up to 100%) instead of running on 0% returns and reporting "unreachable".
- **Projections ask for a return rate first** when none is set, with a link to where it's set, instead of failing.
- **"Save as a new Plan" says why it's disabled** when a profile kind isn't active.
- "Print Advisor Report" is now **"Print Full Report"**.
- **Actual: Expense year-over-year fills in.** It was empty on Actual because Ledgr didn't have category names. Income categories (salary, starting balances) are left out, as they already were on YNAB. Split transactions and closed accounts are still not counted on either app; that's planned.

### Fixed

- **The sample Docker Compose install starts.** The database setup step couldn't load SQLite in the image, compose didn't pass `ENCRYPTION_KEY` or optional settings, and the app refused to run without Authentik.
- **Actual transactions carry their category and payee names** (they were blank, or showed an id). A payee with no name shows blank, never an id.
- **Five milestones now record when reached** (savings rate and the contribution steps); they were judged on $0 contributions. Each gets the date you next visit Milestones.
- **The setup wizard no longer dead-ends** on its Admin step after a reload or once an admin exists.
- **The public demo shows "Choose a demo profile again"** when its demo session has ended, instead of loading forever.
- **SimpleFIN:** testing the connection counts against SimpleFIN's daily request limit, stops at it, and sends one request instead of up to three; "Sync Now" right after a test says when Ledgr last asked SimpleFIN, instead of "synced moments ago".
- **YNAB setup:** loading your budget list checks YNAB's answer and shows a plain message on failure, never YNAB's raw reply.
- **Tiingo:** a saved key that can't be decrypted (saved with a different `ENCRYPTION_KEY`) says so and asks you to enter it again, instead of "Couldn't reach Tiingo".

### Security

- **Restoring, importing or resetting can't leave the sign-in page offering "Create the first admin" to anyone** while a local admin or Authentik remains to sign in with.
- Two people creating the first admin at the same moment can no longer both succeed (PostgreSQL).

---

## [0.9.8] - 2026-11-03

A safety release: nothing a budget app, SimpleFIN, SEC or Tiingo sends is used until it has been checked, and a sync or push that fails says what happened and what changed.

### Fixed

- **Ledgr checks what your budget app and data feeds send before using any of it.** A changed or broken answer from Actual, YNAB, SimpleFIN, SEC or Tiingo used to be stored as $0 or a blank — a debt shown as paid off, a savings balance zeroed, a balance stored as "NaN" — with the sync reporting success. Now the sync stops, nothing is changed, and you're told what was wrong (for example "Actual sent something Ledgr doesn't understand").
- **Failed syncs and pushes say what happened and what changed**, instead of "Something went wrong on our end": an expired sign-in says to reconnect, a push that stopped partway says how many targets it wrote, and a failure before any write says nothing was changed. The Settings cards show the same words.
- **Retirement withdrawals never take the whole balance to cover taxes.** In some plans the tax gross-up overshot and withdrew everything in one year, so the plan failed the next. It now finds the withdrawal that covers the need, within a cent.
- **Pushing goals to your budget app reads every target before writing any**, so a failed read no longer leaves some targets updated and others not.
- **Snapshot pushes to your budget app:**
  - A snapshot dated after your Actual server's "today" posts once, instead of again on every retry, and its adjustment uses balances as of the snapshot's date.
  - A resync checks every account before removing the old adjustments.
  - An adjustment whose confirmation was lost is found and removed when the push is rolled back.
  - A YNAB resync of an unchanged balance posts again; it was blocked by the deleted adjustment's import id.
- **SimpleFIN:**
  - One unreadable account no longer stops the others; a holding or transaction it can't read leaves that account's holdings as last known, and its balance still updates.
  - Balances, loan balances and today's snapshot are saved together.
  - A pending transaction is dated by when it happened, not as 1970, so it isn't counted twice once it posts.
  - An account that misses a sync no longer loses that stretch of transactions.
- **Actual goals:** a category note that won't load stops the sync instead of showing that goal as unset.
- **Testing your Actual connection really asks Actual.** The Test button always said "Connected".
- **Adding a fund or confirming a stand-in** says what was saved when SEC can't be reached.
- **The public demo works again**, and its profiles show sensible figures (match caps, linked jobs, income and portfolio size).
- **Database upgrades never record a failed migration as applied.**
- **Restoring a backup from the command line works on SQLite again.**

### Security

- **Dev Login is available only in development builds**, never in production or the demo, and sign-in tokens without a sign-in method are rejected.

### Changed

- Ledgr runs on Node 26.13.0 everywhere (the image, CI and local development).

## [0.9.7] - 2026-11-01

### Fixed

- **Current Balances shows money the balances already show going in.** "Paid in" comes from the transactions your institutions send, which arrive several days late, so a recent day's figure was missing deposits. Each close's figure now includes money the balances already show, marked "~" until it's reported; hover for the breakdown.
- **A backdoor Roth contribution waiting to be converted is no longer called pre-tax money.** The pro-rata check read today's traditional IRA balance as Dec 31's, so a monthly backdoor deposit a few days before its conversion warned that the backdoor was mostly taxable. For someone going the backdoor route, that deposit is after-tax money; the Roth IRA card names it and says to convert it before Dec 31.

- **Finalizing a year works on every install.** It failed outright on SQLite. A category with no yearly row now gets one, so a year can't stay half-finalized or be finalized twice.
- **Performance's lifetime totals keep their history.** The Retirement row now starts from what its categories have on record, and a category with no stored row in a finalized year no longer resets to zero. **Your Retirement lifetime figures may rise** if your history was imported.
- **Past dates use the loan's schedule, not today's balance.** Finalizing an earlier year could store today's balance as Dec 31's, and Net Worth's mortgage change read $0 between two dates this year.
- **Saving a snapshot that pulls balances from your budget app** now updates Performance and Net Worth together.
- **A family HSA is sized at the family limit** in Contribution Profiles, and the limit always matches the coverage shown, including with two HSA rows.
- **A person born on January 1 keeps their birth year** on servers behind UTC. The same fix covers year-end and loan dates.
- **Raises on the active Salary Profile update extra-paycheck transfers**, instead of leaving them at the old pay.
- **Savings transfers stay paired.** Editing one side moves the other, deleting one side deletes both, and a transfer to the same fund is refused. Bulk savings changes now save all or nothing.
- **Deleting things cleans up after itself.** A person with retirement settings can be deleted (the primary person can't while others remain), and deleted accounts, debts, loans, assets and deductions leave no budget links or profile values behind.
- **Reset all data** clears the settings that pointed at the wiped data, in one step.
- **Budget and fund safeguards.** A deactivated fund's target is no longer pushed to your budget app, and two funds can't share a category. Extra-paycheck rules can't overlap or run backwards, and fund percentages stay between 0 and 100.
- **SimpleFIN:** a whole account is no longer suggested beside a part already linked, Current Balances' recent activity lists only counted accounts, and a day missing a fund's value no longer reads as selling it.
- **Performance vs snapshot check** works for evening updates; utilities year-over-year compares the same months.
- Cost basis edits save correctly, budget sync handles large budgets in batches and flags missing mapped accounts, the Strategy retirement lever re-runs the plan with the new age, and settings follow the active retirement profile.
- **Setting a year's contribution rate to 0% pauses contributions** until you change it, along with any match that depends on them; flat employer money keeps coming. It used to mean "no limit", so contributions carried on.
- **Stress tests keep your gap between general and post-retirement inflation.**
- **Roth basis at retirement reflects gap-year draws**, read from the projection itself, so early access no longer looks better than it is.
- **A new loan or card feed isn't counted as money.** An unlinked feed that owes money stays out of Current Balances and is flagged for linking.
- **A SimpleFIN feed linked to one part of an account compares with that part,** not the whole account.
- **Your purchase vs estimated home value choice stands.** Budget pulls update the value and no longer switch it.
- The prior-year contribution editor shows only to those who can save it, and warnings no longer show a raw person number.
- **Budget targets follow one rule in every integration.** A monthly push replaces only a monthly target (or none). A yearly, weekly or dated target is left alone and reported as skipped, as Actual already did; YNAB used to overwrite it. A fund taken to $0 now clears the target it had.
- **Turning a fund into a budget item keeps its monthly funding**, and tells you if the fund had met its goal.
- **A joint account set per paycheck with no job** is flagged when your pay schedules differ, rather than using whichever job came first. Attach a job or use a monthly amount.
- **Labels name the budget app you actually connected.** House and Brokerage always said YNAB, even with Actual Budget connected.
- **With no active retirement profile set**, the plan says which profile it's using instead of choosing silently.

### Added

- **A mortgage servicer's SimpleFIN feed can be your loan's balance.** Link it under Settings > SimpleFIN. It replaces the balance from your budget app for that loan, its date shows on the House page, and it stays out of Current Balances.
- **The projection chart's tooltip shows each year's assumptions:** plan return, the Simulation's return and volatility, inflation with its spread, how far prices have moved across the runs, and Guyton-Klinger's anchor rate with its range.

### Changed

- **Simulation inflation now varies year by year inside each trial**, through spending, Social Security, tax brackets and today's dollars. Trials used to run at one average rate. Expect small changes: on a real plan the success rate held and the median moved under 1%, with a slightly wider range mid-plan.

### Security

- Rate limiting uses the address the proxy saw, not one the client can claim.
- Removed an unused way to save integration settings that stored credentials unencrypted.

---

## [0.9.6] - 2026-11-01

### Upgrading

- **Projections move, for every two-person household.** The plan used to run on the average of the two ages, a spreadsheet leftover. It now runs from each person's own age and retirement date. For a couple four years apart who both retire at 55, withdrawals start when the younger one retires, the working person keeps their pay and contributions until then, and the plan runs two more years, to the last person's end age. The yearly return rate now follows the primary person's age, so results depend on who is primary.
- **Years with one paycheck now draw from your accounts.** If one person retires first, or a job ends before its holder retires, the shortfall between your budget and what's left of your pay comes out of your accounts. The plan used to assume the remaining paycheck covered everything. Balances in and after those years are lower than they were reading, and a year that can't be funded now fails the plan.
- **Saved Custom clamp bounds now apply.** If you set them, Custom simulations change.
- **SQLite installs:** saving anything that wrote in a transaction, backup import included, used to fail. It works now.

### Changed

- **The plan reads in years.** The retirement graph and table, hero cards, the dashboard, Plan comparison, Milestones and the report show years, since an age means something different for each person. Hover a year in the graph or table to see everyone's age.
- **Coast FIRE names whose age it is**, for example "2035 (Alex, 48)", and its input is labelled with the primary person's name.
- **A bracket target is a preference, not a spending limit.** Waterfall withdrawals now use your other accounts first, then go past the target to fund your spending, and say so that year. Your own caps stay hard. Bracket filling already spent past the target; now it says so too.

### Added

- **You choose how years with one paycheck work.** In Retirement Profile → Timeline: keep saving as planned or stop, and withdraw what pay doesn't cover or spend only what's coming in. The projection marks these years, and hovering one shows the money.
- **The mortgage ends in the projection.** Pick the budget line that pays your loan on the Liabilities page, and the plan stops spending it the year after payoff, before or after you retire. Taxes and insurance stay, and retirement spending you typed in as a figure stays as entered.

### Fixed

- A household where only one person has a job no longer stops that person's work early because of the other's retirement age.
- Percentage withdrawals no longer lose money a Traditional or Roth cap cuts: it moves to the next account, or shows as unmet.
- The last-resort withdrawal counts what the year already drew against your caps.
- Roth money past 59½ now ranks as free when choosing what to draw, ahead of brokerage gains.
- Withdrawal comparison: Legacy and the average, lowest and highest figures are each in that year's own today's dollars (Legacy read about twice too high).
- Budget: a yearly contribution shows as a twelfth a month ($6,500 showed as about $14,083).
- Savings: Settle all works with both sides of a transfer.
- Paycheck: take-home counts the 0.9% Additional Medicare withholding (about $900 a year at $300k).
- Custom Simulation clamp bounds are saved.
- Restoring a version or backup no longer fails when a budget line is linked to a contribution account.

---

## [0.9.5] - 2026-10-31

### Upgrading

- Profiles from before this version keep Social Security coming out of the portfolio-sized strategies' amounts, so those projections don't change. Turn the switch off on a strategy to use the published definition.
- If one budget account is pulled into two places, saving your mappings asks you to keep one — and the same for two budget accounts pulled into one debt, loan or asset.
- **Two-person households:** each person's RMD now comes from their own accounts and is figured on their year-end balance after growth, so RMDs run higher and per-account balances can change. A new warning can appear when an RMD can't be met from Retirement accounts. Each salary now grows at that person's own raise rate, so the employer match and fixed savings that scale with pay can move when raises differ.
- **Rotate your budget and market-data keys after upgrading.** Before this version the change log kept each saved API key and token in plain text (Settings → Data Browser could show them, and database backups carry them). This version stops that and scrubs the old entries, but rotate the Actual and Tiingo keys and revoke any YNAB token you once connected, since they were readable until now.
- **Projections with Social Security move.** Benefits now grow with your inflation rate and their taxable share is now taxed. Over a long retirement the raise is usually the larger of the two, so most plans last longer; early years show more tax, and plans with little in the portfolio or with no tax table (a flat rate) can run out sooner. Claiming-age and bracket recommendations can change.
- **Simulation results move.** Trials now vary inflation around your own rates instead of the Simulation preset's 2.5–3% mean, so a plan whose inflation differs from the preset's reads differently — and changing your inflation now changes the Simulation. Simulation assumptions set only the spread; a saved inflation mean is ignored. Cached results recompute.

### Added

- **IRMAA in your budget or on top of it.** With IRMAA awareness on, Healthcare lets you choose whether the surcharge sits inside your budget (the default, so nothing changes) or on top of it. It covers only the income-based surcharge; put standard Part B and D premiums in your budget.
- **Money Guy's Goldilocks rule for lump sums.** Adding money in Retirement's "Changes by year" or on Brokerage now says how big it is against what you'll have invested then: under 10%, invest it at once; from 10%, spread it over 5 months, one more for each further 5%, up to 12. The uninvested-cash recommendation paces a large amount the same way.
- **"Save your raises (60/40)" milestone.** Money Guy's rule: at least 60% of each raise goes to saving and investing. For each finalized year with a raise, Milestones compares the change in what you contributed yourself (every account, employer money left out) with the change in household salary, and lists every raise judged. Bonuses aren't judged; years with estimated contributions are marked.
- **"Always Be Buying" milestone.** Two checks of Money Guy's rule. Month by month where SimpleFIN shows deposits: a month without one breaks the streak, while a month no feed reported is left out. Year by year: in each year your investments lost money, did your own contributions hold at 90% of the year before? The Milestones page shows the months and the losing years.
- **Variable Percentage Withdrawal (VPW).** A new spending strategy, the Bogleheads method: each year withdraw a percentage of the portfolio set by your age (the younger spouse's, for a couple) and your stock share, which comes from your allocation glide path. It spends the portfolio down by age 100, stops growing at 10%, and matches the published VPW table to the tenth of a percent. Social Security comes on top.
- **Social Security with the portfolio-sized strategies is your call.** Constant Percentage, Endowment, Vanguard Dynamic, RMD Spending (from the RMD age) and VPW each have a switch, "Social Security comes out of this amount". Off, the published methods' definition: the amount is what leaves the portfolio, tax comes out of it and Social Security comes on top. On, the amount is your spending and Social Security pays part of it (how Ledgr ran them before). Profiles from before keep "on", so their projections don't change; new profiles and VPW start "off". Coast FIRE, the Simulation's starting income and the projection table read what you actually spend in either mode.
- **Debts can follow a budget account.** In the integrations mapping, any budget account (on-budget included) can map to a debt, the same way a mortgage's loan balance does: each sync stores the balance, Liabilities shows "synced from budget <date>", and net worth, snapshots and milestones use it. The balance you typed stays and comes back if the mapping is removed. A debt whose synced balance reaches zero counts as paid off.
- **Two borrowing milestones (new "Borrowing" group).** Money Guy's 20/3/8 car rule: each open car loan with at least 20% down and a term of 3 years or less, and all car payments together under 8% of gross pay. Student loans against first-year pay: each person's total borrowed against their first full year of salary on record. Debts gain a purchase price and a term for these.
- **Current Balances replaces the Live Balance card.** It shows the most accurate figure for each linked account: what the institution reported or, when your snapshot is newer, your snapshot, then moved to the latest market close where the holdings can be priced (marked as an estimate, never saved). Each balance now shows the market close it's really from and when it was reported. Ledgr works that out by matching each fund's reported price to its market closes, and from each institution's own pattern where it can't; some institutions' evening reports are a market day behind. Your portfolio snapshot is always taken as the most accurate figure: an institution's report replaces it only when it's from a later market close. Every figure on the card is at one market close — the latest every fund has a price for — and each account's move into that close, plus **Daily movement** for the last five closes, comes from each fund's own price change, so a sync that runs a day late can't put a move on the wrong day and deposits never read as market gains (money paid in or out is shown beside the move). Funds with no ticker are priced from the institution's own reported value ÷ shares; until that close's price arrives the account shows "—" instead of a guess. Net Worth shows the same current-balances estimate under its total.
- **Milestones, Recommendations and Benchmarks read as one set.** The three Insights pages open with the same kind of card and share one layout: rows read name, value, when and source, with a colored edge for status; cards stay put when you open a row; and the pages link to each other. Milestones leads with what you've reached, Recommendations with what to do. On Benchmarks each account folds to one line with its mix and blended fee.
- **Your plan, shown where it's used.** Net Worth shows where the plan expected your accounts by now, from your last finalized year, and what defines it. Benchmarks puts your real return beside the return your projections assume, marks each past year against the range the Simulation expects, and can chart each Simulation preset's target mix, marking the active one. Budget says what your projection spends before and in retirement, following your withdrawal strategy. Contributions shows the Coast FIRE result for your active plan. The mortgage says how the projection treats the payment after payoff. Milestones says its dates come from your projection, and a recommendation with a yearly amount shows what it could be worth by retirement.
- **Market prices are kept, and Tiingo is asked less.** Daily closes are stored in the database (migration 0010), so each is fetched once and a restart or a Tiingo outage keeps every price already fetched; Tiingo is asked only for a missing close, at most every half hour per fund. A rate limit is no longer retried (each retry spent another of the free plan's 50 requests an hour): Ledgr waits for the next hour instead. Distributions and splits come from the stored raw closes, so a new distribution can't change past days' moves.
- **Fund history keeps every sync.** A feed that reports a market day late used to have each Friday-evening sync written over by Saturday's, losing a day of fund values every week; every report is now kept (migration 0009, index only).
- **Milestones remember when they were first reached.** A milestone reached from now on shows "New" for 30 days and "First reached <date>" in its details. Ones already reached keep the year the history dates them, if any. Ledgr judges this itself on your active profiles, so a What-If on screen never records one.
- **The high-income line follows your filing status, and you can set it.** At or above it the employer match is left out of the savings rate by default. It's $200k married filing jointly and $100k otherwise, by this year's filing status (by household size when none is set), and admins can set their own beside the match switch on the Dashboard and the Contributions page. Every savings rate, the Checkup and the Milestones use the same line, and they wait for it instead of briefly showing the $200k result.

### Fixed

- **Simulation presets mean the same thing everywhere.** The preset you pick now sets both the Simulation and the strategy comparison, and the comparison says which one it used; the choice is saved. Coast FIRE's Simulation now uses the Default preset's return overrides, your saved asset-class changes and its return limits, and the strategy comparison uses its preset's returns, volatility, glide path and limits, so their numbers can change. The year-by-year projection's stock share (for VPW) and the glide-path check read the Default preset instead of Custom.

- **Social Security gets its cost-of-living raise.** Benefits stayed at today's amount for the whole projection while spending and tax brackets grew with inflation, so a benefit lost about 40% of its value over 20 years and plans read as worse funded than they were. Benefits now grow with your Inflation rate; in today's dollars they stay what you entered. The help text said they followed the Post-Retirement Raise, which was never so.
- **Tax on Social Security is charged.** The taxable share raised your tax rate, but nobody paid the tax on that share itself — on $60k of withdrawals and $40k of taxable benefits, $4,584 of a $7,640 bill. It's now part of the year's tax. A benefit above your spending pays it first, and a withdrawal covers the rest. The projection table shows it on its own line, apart from the rate on withdrawals.
- **How much Social Security is taxable counts brokerage gains and taxable Roth growth,** not just Traditional withdrawals, as the IRS formula does.
- **Guyton-Klinger ignores Social Security's raise.** Benefits are compared in today's dollars, so only one starting or stopping moves the starting rate.
- **API keys and tokens no longer land in the change log.** Every saved credential (budget, SimpleFIN, Tiingo) was logged in plain text with the change that saved it. They're replaced before logging now, and the upgrade scrubs the ones logged before.
- **Backup contents need the Backups permission.** Any signed-in user could open a backup's table preview — admin sign-ins and connection settings included. Previews now need the same permission as making and restoring backups, and the tables that hold credentials show only their row count.
- **A sync can't zero your balances.** When Actual didn't return one account's balance, that account came back as $0 and the sync wrote it into everything mapped to it — a debt read as paid off, the mortgage balance zeroed, cash gone. A missing balance gets one more try; still missing, the sync stops and says which account, keeping the last good figures.
- **Cash keeps each account's sign,** so an overdrawn checking account takes from cash instead of adding to it, and cash from mapped accounts reports how old the synced figures are. With a budget app but no account detected as cash, the cash you entered is used rather than $0.
- **A failed transaction fetch stops the sync.** A sign-in failure, timeout or network error on one Actual account quietly saved an incomplete transaction list. The sync now stops and names the account; an account that no longer exists is still skipped.
- **Pulling budget amounts writes to the connection's column,** matching the preview and push. It no longer zeroes items whose budget category has no goal, and no longer breaks on items with no amount columns.
- **Recurring extra mortgage payments from the 29th–31st keep their schedule.** They land on the last day of shorter months and return to the original day, instead of drifting and dropping a payment.
- **Portfolio accounts are push only.** Set to pull, one would have been written as an extra asset and counted twice in net worth. Settings no longer offers it, saving refuses it, and the sync skips it.
- **The default retirement profile can't be deleted.** With no profile explicitly chosen, deleting the one in use was allowed and the projection silently switched.
- **Vanguard Dynamic says its limits are nominal.** Its 5% ceiling and 2.5% floor are before inflation, like every percentage-based strategy's floor; nothing changes in the numbers. The published method applies them to inflation-adjusted spending, so results won't match its 4.7% figure exactly.
- **Saved Brokerage lump sums stay put.** After a reload, the first add or delete replaced or cleared the events you'd already saved.
- **Fixed contributions taken from bonus checks keep their amount.** An HSA or other fixed monthly or annual payroll contribution also taken from bonus checks came out as infinite and was capped to $0 in the summaries and the projection.
- **Deleting a budget profile can't zero retirement spending.** If the profile chosen for retirement is gone, the plan uses your active budget profile instead of $0, and deleting a profile clears the retirement and budget-app settings that pointed at it.
- **Each person's RMD comes from their own accounts.** It was enforced as one household total, so a 78-year-old's RMD could go untaken when routing drew from a spouse's account. Moving a draw to the right person adds no income, and a shortfall stays that person's rather than falling on a spouse.
- **RMDs use the year-end balance.** In two-person households each person's RMD left out that year's growth, about 6% low at a 6% return.
- **Each person's raise rate counts.** Everyone's salary grew at the primary person's rate, so a second person's own rate saved but changed nothing.
- **An HSA withdrawal doesn't count toward an RMD,** and doesn't shrink a reported RMD shortfall or its penalty.
- **The employer match follows each person's own pay.** With different raises, a match grew with the household's pay; it now follows the pay of the person whose account gets it, and so does a fixed saving that scales with pay.
- **A sole earner who isn't the primary person uses their own raise and salary changes.** Their rate and year-by-year salary changes saved but did nothing.
- **An IRA with no owner counts for the primary person's QCD,** as it already did for their RMD.
- **The projection and the report show each person's raise** when they differ.
- **HSA withdrawals say how they're treated.** Projections count them as non-medical: ordinary income, plus a 20% penalty before 65. Settings showed HSA at 0% and the methodology called it tax-free and always last, none of which matched the numbers. The numbers don't change. Medical spending from an HSA isn't modeled, so the projection may overstate that tax.
- **One person's QCD no longer reduces a spouse's RMD,** and a household whose older person has no Traditional money no longer forces an RMD on a younger spouse.
- **Traditional accounts with no owner now count toward the primary person's RMD,** with a warning, instead of having no RMD at all.
- **The report dates an IRMAA surcharge to income two years earlier.**
- **The Simulation follows your inflation.** Each trial's inflation varied around the Simulation preset's mean and replaced both your inflation rate and your post-retirement raise, so your own figures never reached the Simulation. Trials now vary around your rates, one shock moving both so your gap between them holds, without the 0% floor that nudged inflation up. Coast FIRE's searches use your saved spread too, as the Simulation does.
- **The Simulation's today's dollars use each trial's own inflation.** Bands, end balances, the depletion note, the assumptions panel and the dashboard's simulated nest egg deflated every trial at your fixed rate, erasing the inflation each one drew. Each trial is now deflated by the inflation it ran with before the percentiles are taken. The penalty-gap shortfall was in retirement-year dollars while labelled today's; it's in today's.
- **The advisor report's worst case is in today's dollars,** as it says — it printed the future-dollar balance.
- **Guyton-Klinger through years Social Security covers.** When Social Security paid all of spending, the guardrails kept judging against the starting rate from before it, and once spending passed Social Security again every small withdrawal read as a raise — a raise a year on a flat portfolio. The starting rate now carries through those years and is rescaled the first year the portfolio pays again.
- **Student loans: a second job doesn't make a year "partial".** The first full year of pay is a year some job ran through January and December — a second job taken mid-year, or one job following another, no longer skips it. The what-if speculative job isn't pay on record.
- **Student loans with no owner are said** when someone else's loans are judged, instead of dropped.
- **Always Be Buying judges each feed.** A month without a deposit breaks the streak only when every feed that takes deposits reported through it; one feed going quiet no longer reads as a missed month because another kept reporting.
- **The high-income line waits for your saved line,** and if it can't load, the Checkup, Contributions and Milestones show an error instead of loading forever.
- **Duplicate-pull messages name your accounts,** not internal ids.
- **A synced mortgage balance no longer outlives its mapping.** Removing the mapping, or deleting the budget connection, now drops the synced balance, so the mortgage goes back to its own figure. Debts behave the same way.
- **A budget account can no longer be counted twice.** Saving mappings refuses one account pulled into two places (say, as a credit card and as a debt). Mappings saved before this rule existed count it once, against the debt or loan.
- **Guyton-Klinger's guardrails judge the portfolio's withdrawal rate.** The rate is what the portfolio pays (spending less Social Security) over its balance, as Guyton and Klinger define it. It was spending over the balance, so once Social Security started the rate read high and the guardrails cut spending the portfolio could afford. A raise or cut is 10% of that portfolio draw (it was 10% of all spending, over-correcting for households mostly on Social Security), and Social Security starting moves the starting rate with it instead of reading as a market gain. Guardrails projections with Social Security change.
- **The Simulation's "stays within budget" check compares your spending with the budget.** It compared the gross portfolio withdrawal, which leaves out Social Security and includes tax, so it read low once Social Security started.
- **RMD smoothing sizes future RMDs from what leaves the portfolio.** It counted spending that Social Security pays as Traditional withdrawals, underestimating future RMDs; households using smoothing may see a little more converted.
- **The strategy comparison shows what each strategy has you spend.** "Spend yr 1" and "Spend avg" sit beside the withdrawals, which aren't comparable once some strategies put Social Security on top.
- **Editing the glide path refreshes the projection,** not only the Simulation — VPW sizes by it.
- **The glide-path warning reads stocks from the asset classes' bucket mapping,** the same rule as the holdings view, instead of matching class names.
- **Recommendations say their amounts in words.** The unlabeled figure beside "Go" is gone; a rebalance names one amount for the move (it could read $107k in the sentence and $108k beside it), and paying off high-interest debt says what the interest costs a year.
- **The holdings check no longer alarms on money between trades.** A deposit waiting to be invested is in the balance but in no fund, which read as "holdings add up to 100% less". The warning now waits until a gap has lasted over a week, and says how long.
- **The strategy analyzer keeps a suggested setting within the range its editor allows.**
- **The retirement report shows the strategy's own settings.** It looked them up by the wrong name and only ever showed RMD Spending's multiplier.
- **Demo households on Vanguard Dynamic and RMD Spending** now use the published methods' definition: Social Security comes on top of the withdrawal.

## [0.9.4] - 2026-10-29

### Added

- **What fund costs add up to over time** — Benchmarks → "What it costs" shows what today's fund costs take from your balance over 10, 20 and 30 years, at your current mix's expected return, with no new money added.

### Changed

- **Contributions get catch-up room as people age in the projection.** Each year is capped at the IRS limits at that year's ages (room from 50, the larger catch-up at 60–63, the smaller one again from 64) — for the active Contribution Profile, a profile used as a switch in "Changes by year", and a relocation's profile from the move year. A switch profile was held to this year's limits for good. At 64, money over the smaller catch-up is now cut, as payroll stops it, instead of going to brokerage. Saving a switch profile warns with the years it's over.
- **The Retirement page loads less** — the methodology write-ups load when you open one.
- **The Taxes page says when a bonus isn't counted.** A job ending this year whose bonus has no month leaves the bonus out of this year's income, since it may be paid after the last day — the Taxes page now names it and says to give it a month.

### Fixed

- **Help no longer says the Paycheck page computes state tax** — it computes federal withholding and FICA only; the README's Relocation line no longer claims a tax comparison either.
- **A job is current from its start date to its end date.** A job whose last day is later this year shows its paycheck again (it disappeared once an end date was set), and this year's income and the Paycheck page's year-end estimate count its checks up to that day. A job that hasn't started shows when it starts instead of a paycheck, and its pay isn't counted yet.
- **Someone who retires before the household stops contributing.** Their pay already stopped in the projection, but contributions set as a fixed amount kept going until the household retired.
- **The Paycheck page's year-end estimate for a job started this year** counts its checks from its start, as this year's income already did.
- **The projection holds an IRA to the owner's pay.** In a two-person household the pay limit on IRA contributions (or the couple's combined pay, filing jointly) was never applied in projected years.
- **The projection follows job dates.** A job with an end date stops — no salary, contributions or match after its last year — and one that hasn't started counts from the year it starts, not from today. A year a job starts or ends in counts as a whole year; the projection says so under its chart.

## [0.9.3] - 2026-10-28

### Changed

- **"Retirement taxes" is now "Tax buckets & basis"** — the page shows where your money sits by tax treatment and holds the basis you enter, so the Basis link from Data sources lands on a page whose name matches.
- **Reference Data links every figure to its document.** IRS limits show the notice each figure comes from; the tax-bracket, capital-gains, IRMAA and poverty-line tables show their source for the year. Each opens the document.
- **A Retirement Profile's filing status can be Auto** — it then follows this year's filing status (the Taxes page setting, else the W-4). Ledgr no longer assumes married filing jointly when nothing says: it uses Single (the highest tax and no spousal Social Security, so a projection is never flattered) and asks you to set it. Profiles keep the status they have; choose Auto on one to have it follow this year's. The Taxes page shows the filing status even when no one has a paycheck.
- **The pay-stub check compares a bonus check too** — choose Bonus check to compare the bonus's own figures.
- **Data sources shows tax data as current**, with the years it covers and when the next ones are due (it said "Not connected").
- **Add a utility from the Utilities page** — pick gas, water or electric, who bills you and the unit, then type its bills or pull them from your budget. The page no longer starts as a dead end.
- **The ACA household size goes up to 12** (it stopped at 6). A household over 8 uses HHS's own per-person step above 8 instead of the 8-person poverty line.
- **A Contribution Profile used as a future switch is checked against the IRS limits when you save it** — over this year's limit, it saves with a warning naming the year it's used from (the projection holds it to that year's limit).

### Fixed

- **This year's income counts every job you had in it.** A job started this year counts from its start date, and one that ended this year counts up to its end — the household tax, the Roth IRA income check and every this-year income figure. If no earlier job is recorded, the Taxes page says pay before the start isn't counted.
- **A bonus is withheld on its taxable amount.** The flat 22% supplemental rate applied to the whole bonus; it now applies after the pre-tax 401(k) or HSA money the bonus check takes, as payroll does.
- **Each check includes Additional Medicare once your year's wages pass $200,000**, as employers withhold it — net pay per check, "withheld so far" and the pay-stub check include it.
- **Saving a Retirement Profile setting no longer resets its filing status** to the W-4's (or MFJ) when the filing status wasn't part of the change.
- **The year-to-date projection for a job started this year** counts its checks out of the ones it pays this year, not a full year's.
- **"Withheld so far" includes a job that ended this year** — on the Taxes page and the dashboard's year-to-date taxes, even when no one has a job now.
- **Simple tax mode is tax-free throughout.** With a filing status set, the one pot's gains were still taxed on the capital-gains brackets (plus NIIT), and the Medicare IRMAA surcharge and ACA check still ran.
- **Live Balance's breakdown lines up** — a long account name wraps in its own column, and the balances and changes stay aligned down the card.
- **The Contributions card's totals line up** — a label that wraps ("Total (retirement only)") no longer pushes its figures below the others.

## [0.9.2] - 2026-10-26

### Changed

- **Recommendations are shorter and say what to do.** Each one leads with a single line (what to do, who or which account, how much), with the how and the figures in the small line under it. "Start here" items aren't repeated in the area cards below.
- **A Roth IRA's route can be set where the account is.** Portfolio → Account & Contribution Settings now shows "Gets to the Roth: Direct / Backdoor" on a Roth IRA contribution (it saves to the active Contribution Profile, the same setting as Paycheck), and the contribution's summary shows which. The "Switch … to the backdoor Roth" recommendation's link goes to the contribution elections on Paycheck, and its detail says which setting to change.
- **The filing status picker shows names, not codes** ("Married filing jointly", not "MFJ"), and its help says what it sets.
- **This year's tax return has its own filing status**, set on the Taxes page. This year's tax, the Roth IRA check and the IRS limits use it; retirement years keep the Retirement Profile's status, so a profile that plans for a different status later doesn't change this year. Unset, it follows the Retirement Profile's (then the W-4) and says so. The Roth IRA panel notes that married filing separately isn't modelled.
- **The Expenses page loads about 430 KB less JavaScript.** It pulled in the server's budget-sync code, and a browser copy of Node's crypto with it, for one list of category names.
- **Tax data is one file a year, with tooling for contributors.** `tax-data/us-federal/` holds `index.json` and a file per year (installs still download one signed file). `pnpm tax-data:check` checks it in seconds without a database; `pnpm tax-data:new-year YYYY` starts a year with every figure blank, so nothing carries over unnoticed; generated JSON Schemas give editors autocomplete; the README lists every key and the conventions, and CONTRIBUTING.md says how to send figures.
- **Every tax figure links to its document.** Each citation now names a document only and links to it (IRS notices and Revenue Procedures, Publications 15 and 15-T, the Code, the OBBBA, CMS, HHS); CI refuses a citation without a link. Several figures cited the wrong document (2026 HSA limits cited the retirement-plan notice; they come from Rev. Proc. 2025-19).
- **CI blocks on page weight.** The bundle check now measures what each page downloads on first load and fails a page over its budget. It used to add up every page's code and failed every build without blocking anything.

### Fixed

- **The Roth IRA check and the household tax use the household's filing status.** Both read the first earner's W-4 status, which is a withholding choice, so a married couple withholding at the Single rate was judged against the Single Roth IRA phase-out. They now use this year's filing status (above); the W-4 only fills in when nothing else is set. The Roth recommendation names the filing status it used instead of asking about married filing separately.
- **The IRS limits no longer drop the married rules when no Retirement Profile is set up.** With no filing status set, they now follow the W-4 like the rest of the app, and stay unknown (never assumed married) with no job either.
- **Two tax tables held the wrong year's figures.** The 2025 capital-gains brackets were 2024's (now Rev. Proc. 2024-40: 0% up to $96,700 married filing jointly, $48,350 single, $64,750 head of household), and the 2026 Medicare IRMAA brackets were 2024's thresholds with estimated surcharges (now CMS's 2026 figures: from $218,000 jointly / $109,000 otherwise, $1,148.40 a year per person at the first tier). Installs pick up the corrections on their next start; a figure you changed yourself stays yours. Retirement projections with IRMAA awareness move slightly.
- **A job started this year is paid from its start date.** The year's pay schedule started every job on January 1, so Social Security looked like it stopped a few checks early, and "withheld so far", the year-to-date paycheck totals, the Contributions page's expected-so-far figure and missed-contribution check, and the pay-stub check's Medicare wages counted checks from before the job began. A bonus dated before the start no longer counts as paid.

## [0.9.1] - 2026-10-26

### Added

- **Your own goals can count invested money alone.** A new "Invested (no cash)" target leaves cash out — for a goal like an invested millionaire — with the year you reached it and when you're on pace to. The existing "Liquid investments" target is now labelled "(incl. cash)"; goals already set keep working.

### Fixed

- **"Investments save harder than you" and "Money works harder than you" count what actually happened.** A past year now counts when its recorded gain (from Performance) beat that year's saving, employer money included, or that year's pay. Before, every year was judged on a napkin 8% of the balance, so a strong year could be missed and a weak one counted. This year can't count until it's over: it shows as on pace until it's finalized in Performance. Later years still use the 8% napkin math, and a milestone you reached stays reached after a weaker year.
- **Spouses with their own self-only HSAs each get their own HSA limit** in Milestones (Financial Order of Operations step 5) and the IRS-room recommendation. Both HSAs were held to one shared limit, as if the household had family coverage. The paycheck's "Covered via" note for an HSA now shows only when the spouse's coverage is family.
- **Privacy mode hides amounts in hover tooltips too.** A tooltip built from something you typed (an account or goal name with an amount in it) could still show the amount while "Hide amounts" was on.

---

## [0.9.0] - 2026-10-26

> Rollup of everything since v0.8.0. For patch-level detail, see the v0.8.x entries below.

### Upgrading from v0.8.x

- **Upgrade from v0.8.14 or v0.8.15.** v0.9.0 folds the v0.8 migrations into one starting schema, so it can only upgrade a database that already has every v0.8 change. On anything older it stops before changing anything and says so: update to v0.8.15 first, start it once, then update to v0.9.0. A new install isn't affected.
- Pull the new image and restart. The upgrade writes a backup first, then applies v0.9.0's changes. It is all or nothing: if any step fails, nothing is changed and the container doesn't start, so the previous image still runs against the database.
- **Going back to v0.8.15 needs the backup taken before the upgrade**, restored together with the v0.8.15 image. Swapping the image back alone isn't enough.

### Tax data

- **Tax data ships as one reviewed file, and updates never overwrite your changes.** Every yearly figure (IRS limits, withholding tables, capital-gains and Medicare brackets, poverty levels) now comes from `tax-data/us-federal.json`, each with its source. Each start brings the database in line with it: new years are added and corrected figures replace old ones, but a figure you changed in Settings stays yours. Installs seeded before the 2026 withholding correction get the corrected tables.
- **Reference Data shows whether tax data is current.** A notice appears when a year's figures are overdue, and the sidebar's Data indicator says so too. "How tax data updates work" explains where the figures come from and when they arrive.
- **Add year in one step.** "+ Year" copies the latest figures forward into every section as _carried forward_. A checklist lists them to confirm, and a Ledgr update with the real figures replaces the ones you haven't edited.
- **Tax data updates between releases (optional).** Turn on in Settings → Integrations (new installs are offered it during setup; existing installs stay off). Once a week Ledgr checks the project's signed tax-data release on GitHub — nothing about your household is sent. A newer file is verified against a key built into Ledgr and checked like the shipped file, then waits in Reference Data showing each figure's current and new value with its source; an admin applies or dismisses it. Figures you changed are never touched, and a newer Ledgr release always wins. `LEDGR_TAX_DATA_SYNC=off` turns it off for a server.
- **Fixed by law.** A new Reference Data section lists the figures set by law that don't change with inflation (investment income tax, when Social Security becomes taxable, catch-up and withdrawal ages, penalties), each with its citation, so everything the calculators assume can be seen in one place.
- **Reset to shipped.** A shipped figure you changed shows the value Ledgr ships, and Reset to shipped hands it back. Shipped figures and years can't be deleted.
- **IRS limits have readable names.** The "Custom" group is gone: every limit sits in a named card (Standard deduction, Social Security & Medicare, Roth IRA eligibility, …). Figures Ledgr no longer reads are listed as "Not used by Ledgr".
- **The IRS-limit growth rate moved to IRS Limits** ("Growth in future years"), out of Return Rates. The retirement plan's assumptions show the rate you set and link to it, instead of a fixed "~2%/yr".
- **Each yearly tax table now comes from its own year.** A new year's IRS limits can arrive before that year's withholding, capital-gains, Medicare (IRMAA) or poverty-line tables. Projections used to pair the new limits with missing tables: withholding fell back to no tax at all, and the others to tables built into the app. Each table now comes from its own newest complete year and is grown forward from that year. IRMAA and poverty-line tables used to grow from a fixed year in the code, which over-inflated newer tables and under-inflated a profile pinned to an older year. A database with no withholding tables at all now stops the projection with a message, instead of taxing every withdrawal at a flat default rate.
- **No built-in tax tables.** Capital-gains, Medicare (IRMAA) and poverty-level tables lived in the code as well as in the tax data, and a filing status a table didn't have was quietly priced at a guessed 15% / 20% / $0. The tax data is now the only source: a projection without a complete table stops with a message, and every table grows from its own year. LTCG and IRMAA tables saved in Settings must have the shape the tax math relies on (an open top bracket, thresholds and rates that only go up).
- **The QCD limit was $4,000 too high.** Charitable distributions from an IRA were capped at $115,000 a person, labelled the 2026 figure; the real 2026 limit is $111,000 (IRS Notice 2025-67). It's now in the tax data with its source, shown under IRS Limits, and grows with inflation in later projection years.
- New reference figures: Roth IRA income phase-outs, the Additional Medicare Tax thresholds you owe on, HDHP minimum deductibles and the IRS total-additions limit. The 2025 standard deduction follows OBBBA ($31,500 married). Tax tables stay current after a restore, an import or a reset, and demo profiles get every table.

### Taxes and paychecks

- **IRS contribution limits are enforced everywhere.** A 401(k), 403(b), IRA or HSA contribution above its limit counts only up to it in the paycheck, budget, contribution summary and every projection year. Saving one over the limit is refused with the most it can be, and it's a top recommendation until fixed.
- **Taxes page** (Planning → Taxes): this year's household tax line by line, with a **Roth IRA check** — your MAGI against the phase-out, direct vs backdoor, and a pro-rata warning. Tell Ledgr whether your Roth IRA money goes in directly or by the backdoor, and the check advises on what you actually do.
- **Paycheck matches your pay stub:** each deduction says how your stub lists it (before-tax Section 125, before-tax retirement, after-tax); other pay and taxable benefits (e.g. imputed life insurance); and **Check against a pay stub**, which compares any figures from a real stub with Ledgr's and names the likely reason for a mismatch.
- **Bonus checks:** each payroll contribution has its own "Also taken from bonus checks" switch; "Bonus goes to" is part of the Salary Profile; annual tax, Household Income and Living Costs count the bonus.
- **Contribution figures agree everywhere** — one rule for bonus-check money and one savings-rate calculation across the paycheck, Contributions, the Retirement card and the projection; the employer match and savings-rate switches (include match, include Portfolio) are shared by every page.
- Fixed: FICA on payroll HSA money, Social Security past the wage base, Additional Medicare on combined wages, the effective tax rate (federal tax ÷ AGI), and bonus 401(k) money counted twice.

### Profiles and Plans

- **Each profile is its own world**, and the active one of each kind (Salary, Contributions, Budget, Retirement) is what every page uses. A **Plan** is a saved set of profiles; applying it makes them active for the household. The header is one "Profiles" panel and a labelled "View" switch.
- **Profiles page** (Planning → Profiles): every profile kind, the What-If sandbox, and up to three Plans side by side. One salary editor, the same as the Paycheck page's. Budget columns are spending levels, and Plan names are unique.
- Older Plans' salaries become Salary Profiles of their own on upgrade.

### Retirement

- **Retirement projections use only retirement money.** Portfolio accounts no longer size spending, absorb contributions over the IRS limits, widen simulation bands or keep a plan from running out. FI milestones and net-worth benchmarks still count every account plus cash.
- **One verdict for "does this plan work"** — simulation success, Coast FIRE, Social Security claiming, tax optimization, relocation, stress tests and the report all use the same rule, and say how a plan fails.
- **The dashboard shows the simulated nest egg** when the Retirement page has run one, and the dashboard and Retirement page describe the same plan (same inputs, same saved "Changes by year", one baseline nest egg).
- **Bridge to penalty-free money** on the Retirement card for anyone retiring before 59½: the years until locked money opens, whether reachable money covers them, and the tightest year.
- **Social Security PIA and claiming-age comparison**, spousal benefits included.
- **Roth & conversions** (was Tax Optimization): a Roth conversion explorer, a withdrawal-strategy comparison and IRMAA alerts, on the same engine as the Retirement page. Withdrawal routing, order and splits are saved profile settings.
- Choose where unspent required withdrawals are reinvested; each brokerage carries its own cost basis.
- Fixed: withdrawals reach money left untouched (bracket filling past the target, emptied accounts' shares, the tax gross-up); the Rule of 55 only for someone who retires at 55 or later; a Roth conversion penalty-free from 59½; Coast FIRE really stops contributions; saved "Changes by year" apply everywhere and the first edit no longer wipes them.
- **Return rates: one entry per run of equal rates.** A row with the same rate as the row before it changes nothing, so it's merged into that row whenever the table changes. Single ages read "20", not "20–20". Projections are unchanged.
- **Return rates are read the same way everywhere.** The relocation calculator averaged the table's rows instead of its years, so a table with gaps between ages (every demo profile) gave a different rate than the same table listed age by age. Monte Carlo without asset classes used 7% for any age without its own row. Both now apply each row's rate until the next row, as projections always have.

### Debts and liabilities

- **Debts list on Liabilities.** List student and car loans, cards you carry a balance on, and personal or medical debt — each with its rate, what you pay each month and the date its balance is as of. Ledgr estimates when each is paid off (or flags a payment that never covers the interest), keeps paid-off debts as history, and counts open ones in net worth alongside your typed "other debts, not itemized" figure and any credit cards mapped from your budget.
- **High-interest debt is judged.** Financial Order of Operations step 3 checks each listed debt against Money Guy's line for its owner's age (student loans above 6% / 5% / 4%, car and other loans above 10% / 9% / 8%, any card balance you carry) and names the ones to pay off first; step 9 estimates the year you're debt-free across the mortgage and every other debt, and paid-off debts appear on the Milestones timeline.
- **Net Worth's other-liabilities figure counted credit cards twice.** Saving it wrote the total — including credit-card balances mapped from the budget — back into the typed figure, so the cards were added again. The card now edits only the typed part ("Other debts, not itemized"), shows it even at $0, and lists the debts list and mapped cards separately.
- **Liabilities' totals ignored other debt.** The summary showed only with a mortgage, "Total Liabilities" was the mortgage alone, "Other Liabilities" was always $0, and two labels said YNAB for Actual users.
- **"Debt-free" said on track with a mortgage alone**, ignoring any other debt.

### Milestones and recommendations

- **Milestones** (Insights → Milestones): Money Guy's wealth milestones, the Financial Order of Operations, the wealth formula, income-multiple checkpoints (Money Guy's or Fidelity's), housing and Bogleheads rules, r/personalfinance's rules, your own goals and a checklist — each with when you reached it, when you're on pace to, and the next step.
- **Recommendations** (Insights → Recommendations): what to do next, ranked by urgency and dollars a year, built from Ledgr's own data — the account and rate that gets the full match, room per paycheck left, where to save first, dollars to an emergency fund, extra principal for a paid-off home, rebalancing that costs no tax, cheaper funds, uninvested cash, tax-loss harvesting, Roth IRA and pro-rata items, and data to bring up to date. Admins can snooze or dismiss one with a note.
- Wealth score tiers follow The Millionaire Next Door, on gross pay. Savings rates are judged to whole percents.

### Investments and performance

- **Investments from SimpleFIN:** holdings, transactions and fund details from linked accounts fill snapshots, Performance and cost basis (you confirm), with transfers between your own accounts recognized. Live balance and recent change for the household and each account.
- **Benchmarks:** your mix against a target-date fund or a blend, a current glide path of your own, rebalancing in dollars, **Holding history** per account (per part for accounts held in parts), and **"Your mix, in index funds"**. Fund costs and account fees are named apart.
- **Performance checks, notes and corrections:** each row flags figures that don't fit together; notes, estimated figures and accepted gaps; past years can be corrected with a preview of everything the change moves, without resetting lifetime totals. "Realized vs assumed returns" moved here.
- Tiingo connection for historical prices.

### Utilities

- **Utility costs from your budget.** Upkeep ▸ Utilities can fill each month's gas, water and electric cost from YNAB or Actual Budget: pick the budget category each utility is paid from and how many months after the service month bills are paid, then pull. A month's cost is its bills less refunds (bills split across categories count their utility part). The preview lists every month it would fill or refresh, flags months with two bills, and leaves any cost you typed alone; months it filled show the budget's name. Usage is still entered by hand.
- **Utilities cost per unit** counted every month's cost against only the months with a meter reading, overstating it (e.g. $5.08/ccf instead of about $1). It now uses only months with both.

### Finding your way around

- **Links land on the data:** a link opens the page in the right tab or view, opens a collapsed section, and scrolls to and outlines what it's about — from the dashboard, Recommendations, Milestones, Financial Checkup and Data Sources.
- **Quick search** (Cmd/Ctrl-K) jumps to any page by name or by what's on it.
- **Privacy mode** hides every amount on the page, including amounts in names and notes you typed.
- The dashboard combines related cards (Budget & Spending, Household Income with taxes, Net Worth with the mortgage, a wide Retirement card); plainer page and setting names; the edit lock says "View only" or "Editing".
- Accessibility and print: color is never the only cue for a gain or loss, keyboard focus is visible, progress bars are announced, charts clear contrast minimums, and printing is always light.

### Budget-provider sync

- **Actual Budget syncs recover after an Actual upgrade**, and a request that creates a transaction (YNAB or Actual) is never sent twice.
- Snapshot pushes to your budget app are an explicit **Sync** button; a link to your budget app sits in the sidebar.

### Security

- Runs on **Node.js 26.12.1** (the October 2026 security release).
- Stored settings of connected services can no longer be read by any signed-in user — admin-only, and never with credentials.

### Under the hood

- **v0.9.0 migration squash.** The v0.8 line (the v0.8.0 baseline plus 12 migrations) is now one `0000_v9_initial_schema` per dialect, generated from v0.8.15. v0.9.0's own changes follow as four separate migrations. The migrator refuses databases older than the baseline, replays a squash in one transaction that checks every table and column afterwards, and labels each backup with the schema it actually came from.
- The PostgreSQL schema is split into one file per domain (`src/lib/db/pg/`), with the SQLite schema generated from it file by file. The data model is unchanged.
- `scripts/test-migration.sh` checks the migration journal, every column and the row counts, and can run against an existing empty database without Docker.
- A household time zone (Settings → General) sets "today" for every server-side date.

---

# v0.8

## [0.8.15] - 2026-10-25

### Added

- **Links land on the data, not the top of a page.** A link opens the page in the right tab or view, opens a collapsed section, and scrolls to and briefly outlines what it's about. From the dashboard:
  - the early-retirement bridge's verdict (Retirement taxes at retirement, or the first short year in the projection);
  - Simulated success and Coast FIRE (Plan Health);
  - Readiness (your checkpoint milestone);
  - Tax-advantaged room and the Contributions card (Paycheck contributions, opened);
  - a savings goal (its card);
  - the mortgage line (the loan);
  - the Roth IRA line (Taxes this year → Roth IRA);
  - a plan that runs out (that year in the projection).

  Recommendations, milestones, Financial Checkup and Data Sources land the same way. Fund, cash and fund-cost items now go to Benchmarks, where those figures are; they used to go to Portfolio.

- Links that already opened a section (Savings → Paychecks & Growth, Portfolio → Account settings, Holding history) also work when you're already on that page.

### Changed

- **Early-retirement bridge** (Retirement card) reads at a glance like Readiness and Growth: a Covered/Short verdict, the years until locked accounts open, the tightest point, and the year chips. Where the money sits, when each person's accounts open, how Covered is judged and the caveats are in its help tip; a short year shows one line on what helps.

### Fixed

- Financial Checkup's "recommendations →" link didn't open, and its rows reloaded the whole page.
- Clicking a fund in the Savings chart did nothing; it now opens that goal.
- **Privacy mode hides every amount on the page.** That now includes amounts in names and notes you typed ("Deck ($20,000)"), milestone labels ("Your first $100k") and tax notes ("about $15 more is due"). Ratios like "per $1" stay readable.
- **Brokerage → By Account** showed another brokerage account's budget link (Long Term Brokerage labelled "R Brokerage"). The label and YNAB balance are now matched to each account itself, not its account type. The links themselves were always saved correctly.
- Two admins dismissing or snoozing recommendations at the same time no longer lose one of the changes. Each change is now merged on the server.
- The dashboard and the Retirement page now show the same baseline nest egg. They could differ by a few cents because they added up the year's balances differently.
- Pages no longer redraw on load because the server and browser saw different data. The server now loads what the sidebar and header load on every page (saved settings, data freshness, profile lists). A page load counts once against the request limit, however many queries it prefetches, so moving quickly between pages can't run out the limit. Seen on Benchmarks (the "Compare with" description) and Performance (the "Basis updated" date).

## [0.8.14] - 2026-10-25

### Added

- **IRS contribution limits are enforced everywhere.** A 401(k), 403(b), IRA or HSA contribution set above its IRS limit now counts only up to the limit in this year's paycheck, budget and contribution summary. The retirement projection holds each person to the limit every year (limits grow over time); anything a percentage contribution carries past it is still saved in a Retirement brokerage, as before. Employer money that counts toward a limit is included, a married couple's family HSA limit is shared, an IRA can't exceed earned income, and a joint account is held to the household's remaining room.
- **Over-limit contributions are an error to fix**: saving one is refused with the most it can be ("set it to at most 20.41% of pay"), the row shows how far over it is, and it's a top recommendation until fixed. An account with no owner, or an HSA with no coverage type, gets a prompt to set one.
- **Performance checks.** Each account row flags figures that don't fit together — a gain that doesn't add up, a year that doesn't start where the last one ended, money moved between tracked accounts with one side missing, an ending that differs from the year's last snapshot — with what usually causes it. The year shows a count, and Finalize lists them before you lock a year.
- **Notes, estimates and accepted gaps on Performance rows.** Add a note to an account's year, mark figures still estimated (a SimpleFIN fill marks the ones it worked out from your paycheck setup), and accept a gap that's on purpose with a reason — it stays quiet only while the gap is the one you accepted. Finalize lists what's still estimated; finalizing never clears it.
- **Correct a past year with a preview.** Past years' figures (and every year's beginning balance) can be edited in the Performance table; saving shows everything the change moves — the row, next year's beginning (with the option to start next year at the new ending), and each year's totals — before it's saved.

### Changed

- **Update Performance speaks plainly**: fields are "You added", "Paid out to you", "Moved between accounts", "Fees & taxes withheld", each with help, plus tips for the account type (ESPP purchases at market value, IRA conversions aren't contributions, HSA refunds, statement totals at year end). The beginning balance is shown and editable, with "Last year ended at … — use that" when a year doesn't continue the last.
- A row that added up before an edit still adds up after it: when you change a figure and not the gain, the gain follows. A row with a gain entered on purpose keeps it.
- A finalized year's latest snapshot can be corrected; its Performance figures stay as they are.
- **Tell Ledgr how your Roth IRA money gets there** — direct, or the backdoor (a traditional IRA contribution converted to the Roth) — on the Roth IRA account in the Contribution Profile or on Paycheck. The Roth IRA check then advises on what you actually do: nothing to decide when you use the backdoor (it works at any income); a warning to act now when you contribute directly close to or over the limit; no more "Direct now" nudge when you haven't contributed yet.
- **Bridge to penalty-free money** on the dashboard's Retirement card, when you retire before 59½: the years until locked retirement money opens, the spending to cover after Social Security, whether the money you can reach without the 10% penalty covers it (and the tightest year), where that money sits (taxable brokerage, Roth contributions, a workplace plan under the Rule of 55), when each person's locked money opens, and — if it falls short — why and what helps. At your assumed returns.
- **Recommendations say exactly what to do, using what Ledgr already knows:**
  - **Employer match** names the account and the rate that gets the full match ("raise to 6% of pay (now 4%)").
  - **IRS limits**: room filled through payroll is spread over the paychecks left this year; IRA/HSA room says it's open until the filing deadline.
  - **Savings rates** say where to start — a missed match first, then the account with the most IRS room.
  - **Emergency fund** shows the dollars to add.
  - **Paid-off home** gives the extra principal a month that pays it off by the target age.
  - **Rebalancing** says where a sale costs no tax (inside a 401(k)/IRA/HSA) or, when it's all taxable, to steer new contributions instead of selling.
  - **Fund costs** say to switch funds where you choose them (IRA, taxable) and to check the plan's menu in a workplace plan — and don't repeat a fund the "cheaper equivalent" item already names.
  - **Uninvested cash** says which under-target classes investing it would rebalance.
- **Budget & Spending bars are readable.** Every bar in the card shares one scale sized to the largest share or range (e.g. 0–40%, labelled on top) instead of 0–100%, so a 13% category no longer hugs the left edge and bars compare across the card. The count reads "at or under range" (being under a spending range counts).
- **Every recommendation says what it's about on its own** — fund costs and expense ratios named, rates say what they measure, savings checkpoints say what's counted, and rebalancing, housing, mortgage, emergency-fund and checklist items name their subject.
- **Two kinds of cost, named apart.** Benchmarks' "What it costs" now shows **fund costs** (expense ratios, taken inside the funds' prices — already in your returns) and **account fees** (charged to the accounts and recorded in Performance) on separate lines, with a year of both together. Performance's fee column and lifetime card say "account fees"; the lifetime card no longer claims to include expense ratios.

### Fixed

- **Correcting a finalized year no longer resets lifetime totals.** An edit to a locked year now moves that year's totals and every later year's lifetime totals by exactly what changed; before, it could recompute lifetime totals from scratch and lose history from before tracking began.
- Yearly Performance totals are rebuilt by account type, rollovers included; editing an account no longer rewrites a finalized year or stores a stray "Retirement" total.
- A snapshot dated earlier in a year than its latest no longer overwrites that year's ending balances, and a snapshot in a finalized year leaves its figures alone.
- **Actual Budget syncs recover after an Actual upgrade.** The first request after the Actual connection starts (when it upgrades and opens the budget) now runs on its own; before, several at once broke the budget's loading and every retry repeated it.
- **Budget syncs never create a transaction twice.** A request that creates something (YNAB or Actual) is no longer sent again after a timeout or server error — it may already have gone through; the next sync picks it up instead. Reads and updates still retry.
- **"Uninvested cash" no longer asks you to invest $0** for a nearly empty all-cash account (such as a traditional IRA emptied by a backdoor Roth conversion): it now needs at least $100 over your target mix.
- **The Rule of 55 isn't granted to someone who retires before 55.** The projection assumed a still-active job ended in each future year, so retiring at 50 made the workplace plan penalty-free at 55; the job now ends at the person's own planned retirement. The Tax Buckets page agrees.
- **A recent Roth conversion is penalty-free once you're 59½** — the 5-year conversion penalty applies only under 59½; the projection kept that money locked.
- Renaming a Contribution Profile no longer wipes its contribution values.
- A resumed portfolio snapshot draft restores every row of an account held in several parts.
- Dividends that stay in an account are no longer counted as paid out (they're already in the balance).

### Internals (no user-facing changes)

- Database migration adds Performance notes, estimates and accepted gaps (runs automatically; older backups restore with none).

---

## [0.8.13] - 2026-10-23

### Security

- **Runs on Node.js 26.12.1**, the October 2026 security release. It fixes high-severity issues in certificate hostname checks (IP addresses written with leading zeros or fullwidth digits could pass as a different address), DNS lookups that cut a name short at a hidden character, and a Brotli decompression flaw that could crash the server or worse; plus updated root certificates and dependencies.

---

## [0.8.12] - 2026-10-21

### Changed

- **"Why trust these numbers?"** on the Retirement page and the validation page describe the testing behind the projection without quoting test counts that had gone out of date.

### Internals (no user-facing changes)

- Runs on Node 26.12; a development type package updated.
- Developer documentation brought up to date with the code (rules, design, testing, engine architecture, README).

---

## [0.8.11] - 2026-10-21

### Added

- **The dashboard shows the simulated nest egg** when the Retirement page has run a simulation for your current plan: the simulated median, its middle range, and the fixed-return baseline alongside. Without a simulation it shows the baseline, labelled as such, with a link to the Retirement page to run one. The Retirement page's hero follows the same rule, and a person filter shows the baseline (the simulation covers the whole household).
- **Choose where unspent required withdrawals go** (Retirement settings → RMD Handling → Reinvested into): when your RMDs are more than you spend and you reinvest the rest, pick which Retirement brokerage receives it, or leave it spread across them. It stays retirement money — never a Portfolio account; with no Retirement brokerage the projection adds a "Retirement brokerage (projected)" that holds it, along with any 401(k)/IRA contributions past the IRS limits (shown once it holds money). Set per Retirement Profile; deactivating the chosen account or moving it to Portfolio clears the choice.
- **A note when a brokerage has no cost basis.** Each brokerage now carries its own cost basis through the projection, and a basis of $0 means everything drawn from it is taxed as a capital gain. When an active brokerage holds money with no basis entered, the Performance page says so (with where to enter it), and so does the projection's warnings list.

### Changed

- **"Realized vs assumed returns" moved to the Performance page,** next to the returns it reads. The Retirement page is for the plan; how past years compare with the plan's assumed return is a performance question.

### Fixed

- **Retirement projections use only retirement money.** Accounts tagged Portfolio (savings outside the retirement plan) are never spent in retirement, but they still shaped the plan. Now:
  - Balance-based spending strategies (Guyton-Klinger, Constant %, Endowment, Vanguard Dynamic, RMD-based) and the rate-seeded first year size spending from retirement accounts only. A large Portfolio account made the withdrawal rate look low, granting raises the retirement money couldn't support.
  - Contributions over the IRS limits go to a Retirement brokerage (with none, a projected one — never a Portfolio account). They also no longer show up two or three times in the per-account balances. Retirement lump sums with no account named do the same.
  - Brokerage goals draw only from Portfolio brokerages, never retirement money.
  - The yearly per-account balance correction takes from or adds to retirement accounts, not Portfolio ones.
  - The Brokerage page's yearly increase and lump sums stay in Portfolio accounts, even when only a Retirement brokerage has a contribution set up.
  - Simulation balance bands, the median and ending balances count retirement money only — a Portfolio account no longer widens the "nest egg" a simulation shows.
  - Simulations in Simple tax mode start from retirement money only. Simple pooled every account, Portfolio included, and added Portfolio savings, brokerage goals and Portfolio lump sums. The simulation assumptions' starting balance and yearly contributions now show retirement money in both modes.
  - "Runs out" means your retirement money runs out. A Portfolio account that's never spent in retirement kept the plan from ever running out; depletion ages (projection, strategy comparison, Social Security and withdrawal-bracket optimizers, stress tests, report) now follow retirement money, and nest eggs at retirement (dashboard, Plan Health, relocation, stress tests, Coast FIRE, tax optimization) count retirement money. FI milestones and net-worth benchmarks still count every account plus cash (liquid net worth).
- **One verdict for "does this plan work."** Simulation success, Coast FIRE, Social Security claiming, tax optimization, relocation, strategy comparison, stress tests, the report and every "runs out" display now use the same rule: a plan fails in the first retirement year that leaves spending unmet or runs retirement money out. Simulation success no longer counts a trial as a success because accounts it can't spend (Portfolio money, penalty-locked money) still hold a balance. Where a plan fails, Ledgr says how: runs out, falls short because money is locked behind early-withdrawal penalties, or can't fully fund spending.
- **Withdrawals reach money that was left untouched.**
  - Bracket filling now draws Traditional money above your target bracket once Roth, brokerage and HSA money is gone, instead of leaving spending unmet beside a full 401(k).
  - Percentage withdrawals place an emptied account's share on the other accounts instead of dropping it.
  - The tax gross-up covers the tax on what can be withdrawn when an account runs short, and includes the 3.8% Net Investment Income Tax.
  - Money held before 59½ that no tracked account accounts for (for example Roth 401(k) contributions before that account has a balance) is no longer drawn as if penalty-free — the projection only draws what your tracked accounts can give without a penalty.
- **The dashboard and the Retirement page describe the same plan.** They built their projection inputs separately: the dashboard ignored the snapshot you picked and your saved withdrawal routing (it sent the defaults), and both fired their first projection before settings loaded (briefly showing $0 contributions). One shared input now waits for your settings, so the dashboard reads the Retirement page's own runs.
- **End Balance shows the simulation again.** With a simulation run, the Retirement page's End Balance showed only the fixed-return baseline: it looked for the simulation's figure one year past the last projected year. It now shows the simulated median and its middle range at the end age, with the baseline alongside, the same way Nest Egg at Retirement does.
- **Editing "Changes by year" right after opening the Retirement page no longer wipes the saved ones.** The first edit started from an empty list instead of your saved changes: deleting one row removed all of them, and adding one saved only the new row.
- **Saved "Changes by year" apply everywhere.** The dashboard, strategy comparison and stress tests ignored them (only the Retirement page sent them), so they described a different plan for any household with saved changes. Every projection now uses your saved changes unless the Retirement page is showing unsaved edits.
- **Brokerage cost basis is each account's own.** Ledgr shared your total brokerage basis between Retirement and Portfolio by balance (and counted accounts missing from the latest snapshot); a retirement brokerage withdrawal was taxed at that blended ratio. Basis now follows each account through the projection, so a withdrawal's capital gains use the basis of the account it comes from. Tax Buckets' "at retirement" view reads the same per-account basis instead of its own estimate (which missed lump sums and contributions over the IRS limits).
- **Coast FIRE (baseline) really stops contributions.** It stopped them by setting the contribution rate to 0, which the per-account path ignored, so contributions and the employer match kept going after the "stop" and some households were told they could already coast when they couldn't. It now stops them the same way the simulated Coast FIRE does.
- **The contribution rate is a retirement rate.** It counts contributions to retirement accounts only, and its cap never shrinks a 401(k) because you also save into a Portfolio account.
- **Relocation's "earliest you could move" names a year the projection has.** When the move works right away, it reported this calendar year, while the projection starts from your latest snapshot's year (the two differ until the first snapshot of a new year).
- **Tax tables stay current after a restore, an import or a reset.** Restoring a version or importing a backup put back that copy's contribution limits and tax tables, and "Reset all data" emptied them, until the app next restarted. They're brought current right away now. Demo profiles copy every tax table (they had only limits and income-tax brackets, missing capital-gains, Medicare-surcharge, poverty-line and tax-parameter data), and a new tax year reaches demos already in use.

### Upgrading

- A "Contribution Rate" saved under Changes by year now caps retirement contributions only; Portfolio savings come on top of it. If you set one to cap everything you save, lower it by your Portfolio savings rate.
- A Portfolio brokerage with a target no longer receives contributions over the IRS limits while you have a Retirement brokerage.

---

## [0.8.10] - 2026-10-20

### Added

- **Check against a pay stub** (Paycheck page, under each person's paycheck): type any figures from one real stub — gross, federal taxable wages, Social Security and Medicare wages or tax, federal withholding, net pay — and see which match Ledgr's and, where one doesn't, the likely reason: a deduction taxed differently than on the stub (named), a taxable benefit Ledgr doesn't have, or the W-4. Social Security is skipped once the year's pay passes the wage base. Nothing is saved.

### Changed

- **Contributions taken from bonus checks are set per account.** Each payroll contribution has its own "Also taken from bonus checks" switch, in the Contribution Profile (on the account under Contributions on the Paycheck page, or Profiles → Contributions) — so a 401(k) can come out of the bonus while an HSA doesn't, and switching Contribution Profiles can change it. This replaces the two bonus switches on the Salary Profile. The Paycheck page's Bonus section lists what the bonus check takes, account by account. An account's employer match counts the bonus when that account is taken from bonus checks.
- **"Bonus goes to" is part of the Salary Profile** (per job), like the extra-paycheck choice — so it follows the active Salary Profile, and anyone who can edit profiles can set it (it was admin-only).
- **One salary editor:** Profiles → Salary shows each job with the Paycheck page's own sections — Pay schedule, Withholding, Bonus, Other pay, Extra paycheck — and both save the same way. The table above keeps salary, bonus and total.
- **Budget columns are spending levels.** Every column uses the active Salary and Contribution profiles; a column no longer has profiles of its own (the What-If tab's "columns with their own profiles" note is gone).
- **Plan names are unique.**
- **A simpler header:** "Profiles [Manage ▾]" opens one panel with the active profile of each kind, your Plans and "Edit profiles →" (it shows the Plan's name when the active profiles match one), and "View [Projected | Year-end | YTD]" is labelled — two controls instead of six.
- **What the savings rate counts is set next to it.** "Employer match" and "Portfolio" are small on/off chips on the savings-rate line of the Contributions page and the Dashboard's checkup card, showing their state — they used to sit with the page's filters and looked like they changed the whole page. The Contributions page's profile picker is labelled and marks the active profile.
- **Portfolio:** Holding history collapses like Snapshot History and Account & Contribution Settings; links to it open it.
- **Plainer words:** the year-by-year changes on the Retirement projection are "Changes by year", Savings' one-month amounts are "Month changes", the extra paycheck's are "Specific months", and Retirement's own spending amount is a "Set amount" (no more "override").

### Fixed

- **Holding history follows each part of an account the institution reports per part.** The joint IRA's daily holdings were pooled into one mix nobody holds (e.g. 65% one person's 2055 fund / 35% the other's 2060). Now each person's Roth and Traditional part has its own history, you enter old statements per part, and the "Your mix, in index funds" benchmark combines the parts by their snapshot balances. Accounts whose parts share one feed, like a 401(k), are unchanged.
- **Plan salaries are back.** v0.8.9 stopped reading the salaries an older Plan carried. Upgrading turns each such Plan's salaries into a Salary Profile of its own ("‹Plan› salary") and the Plan uses it.
- Two quick edits on the Paycheck page could save over each other; each edit now saves only the field it changes.
- **Relocation** compared contributions on base salary only. It now counts what the bonus check takes for accounts taken from bonus checks, and figures the employer match the same way as the Contributions page.

### Upgrading

- The upgrade converts your data: each person's "Bonus goes to" choice into their Salary Profile entries; the Salary Profile bonus switches into each payroll account's "Also taken from bonus checks" in every Contribution Profile (each follows the Salary Profile its Plans use it with, else the active one; where Salary Profiles disagreed, the upgrade log says which it used); duplicate Plan names get a number. It then removes what v0.8.10 no longer uses (Plans' stored salaries, Budget columns' own profiles). Going back to v0.8.9 afterwards needs the backup taken before the upgrade — restore it together with the v0.8.9 image.
- Holding history periods entered before this version are whole-account. On an account now kept per part, each shows under the account as needing a part — move it to the right part or delete it; it isn't counted until then.

---

## [0.8.9] - 2026-10-20

### Changed

- **Profiles and Plans:** each profile is its own world, and the active one of each kind is what every page uses. The header now has a picker for each — Salary, Contributions, Budget and (new) Retirement — plus a **Plan** menu. A Plan is a saved set of profiles, one of each kind: applying it makes them the active profiles for everyone in the household (it asks first), and the header shows the Plan whose profiles you're using, or "None (unsaved mix)" after you change a picker — with "Update ‹Plan›" and "Save as a new Plan". There's no "Main Plan" or browser-only Plan any more, and Plans no longer carry salaries of their own.
- **Profiles page (Planning → Profiles):** Salary, Contribution, Savings and Retirement profiles, the What-If sandbox, and **Plans** — which puts up to three Plans side by side (their profiles, take-home pay, budget spending, what's left, sustainable withdrawal at retirement, how long the money lasts). These used to be tabs on the Budget page; old links still land on the right tab. The Budget page is now the budget itself.
- **Paycheck page:** shows and edits the active profiles (the page's own Salary/Contribution pickers are gone). Unlocked, each section says where its edits save ("Saves to Salary Profile '…'"); setup like employer, deduction names and tax treatment is admin-only, and without permission to edit profiles the figures are view-only instead of saving nowhere. Laid out as two balanced columns with every amount in one column; the bonus can now be set up here even before there is one; a deduction that's both before and after tax reads "401k (Traditional)" / "401k (Roth)"; the extra paycheck links to where its split is set up in Savings.
- **Retirement and Roth & conversions:** the profile picker switches your active Retirement profile. **Savings:** Pull In New Pay / Update % use the active budget profile (the separate picker is gone).
- **Names:** Taxes this year, Retirement taxes (was Tax Buckets), Roth & conversions (was Tax Optimization), What-If (was Budget Scenarios), "target mix today" (was current glide path). Contributions moved under Cash Flow; Holding history moved to Portfolio. Old names still work in Quick search.
- **View toggle** reads Projected / Year-end estimate / Year to date everywhere; Living Costs and the Taxes page say when they always show the full year.
- **Edit lock** says "View only — unlock to edit" or "Editing" instead of a bare padlock. Switches, choice buttons and editable figures look the same across pages.

### Fixed

- Directions to Settings and Portfolio ("Settings → Integrations", the IRS limits milestone step, and others) are now links that open the right tab or section.
- A Budget profile used by a Plan can no longer be deleted (it would have left the Plan incomplete), matching the other profile kinds.
- The extra-paycheck choice on the Paycheck page could save to a different Salary Profile than the one shown.
- Disabled switches lost their layout.

---

## [0.8.8] - 2026-10-19

### Added

- **Taxes page (Planning → Taxes):** this year's household tax line by line — income, pre-tax money, AGI, taxable income, federal tax, Social Security, Medicare, effective and marginal rates, what's been withheld so far — with its notes (e.g. Additional Medicare owed at filing), and the Roth IRA check below.
- **Roth IRA MAGI and direct-vs-backdoor** (Taxes page; the Household Income card shows one line — MAGI and the verdict in a few words): your Roth IRA MAGI — salary + bonus, less pre-tax payroll money and HSA money paid outside payroll, plus taxable investment income (dividends and interest in taxable accounts: this year so far plus last year's rest of the year, or annualized where an account's history is shorter). It compares that with the year's phase-out range and says "direct contribution OK" only with a safety margin below it (by default the range's own width; admins can change it on the Taxes page), "too close to call" with each person's allowed amount inside the margin or range, or "use the backdoor" above it. When a conversion is on the table, it warns about pre-tax IRA money that would make it mostly taxable (pro-rata). It names what it can't see (bank interest, sold investments, accounts without a feed). A tiny leftover pre-tax balance (under 1% of the IRA limit) doesn't trigger the warning. Needs the Portfolio permission; otherwise you see AGI from wages.
- **Recommendations:** a Roth IRA item (backdoor or too close to call) and a pro-rata item per person with pre-tax IRA money, both pressing from October through year-end; for last year's taxes, only the Roth item until the filing deadline.
- **Recommendations — uninvested cash:** an account holding noticeably more cash than your current glide path's cash target (outside the same 5/25 band rebalancing uses) shows "about $X to invest"; HSAs are judged against a cash buffer instead — by default the year's HDHP minimum deductible for your coverage, editable by admins under the HSA in "What you hold now". Needs a current glide path and the Portfolio permission; a traditional IRA is skipped while a backdoor Roth is the plan.
- **Recommendations — funds:** tax-loss harvesting (positions in taxable accounts worth at least 5% less than the average cost your institution reports, with the wash-sale caveat), and a cheaper equivalent for a single-class fund in an IRA or taxable account whose fee is well above the low-cost line — naming an index fund for that class and the yearly saving down to that line. Workplace-plan and HSA menus are left alone.
- **Live Balance — recent change:** the change over the last 1 and 7 days (30 and 90 days appear once the stored daily balances reach back that far), for the household and each linked account, with the date it's measured from. It's the raw balance change, so it includes deposits and withdrawals. Needs the Portfolio permission.
- **Holding history (Benchmarks):** what each account held over time. Periods from your daily SimpleFIN holdings fill in on their own (a new period starts when the set of funds changes); for the years before your feed started, or an account with no feed, enter periods yourself — dates, funds and percentages — adding a fund by ticker (checked against SEC's fund list) or, for a workplace plan's own fund, by name with its fee and mix. An account with entered history can't be deleted (deactivate it instead).
- **"Your mix, in index funds" (Benchmarks comparison):** your own funds' mix over time, from your holding history, priced with a plain index fund for each asset class and run through the same deposits and withdrawals as the other benchmarks — what the same choices would have earned in index funds. It starts at the first full year your history covers and says how much money it had to leave out (funds with no known mix). No ahead/behind verdict yet.
- **Removed: the old per-snapshot holdings entry** ("Accounts SimpleFIN doesn't report holdings for" on Benchmarks) and its table. Holding history replaces it — enter periods for an account with no feed there. Any rows it held are kept only in the automatic pre-upgrade backup (restoring that backup skips them).

### Changed

- **Paycheck matches your pay stub's lines:** each deduction now says how your stub lists it — _Before-tax (Section 125)_ for health/dental/vision/payroll HSA, _Before-tax (retirement)_ for a traditional 401(k), or _After-tax_ (Roth 401(k), disability, life insurance, dues) — and you can change it right on the pay stub. New **Other Pay & Taxable Benefits** section: extra pay on every check, or a taxable benefit that's never paid (e.g. group life insurance over $50k — "imputed income"), which raises your taxes but not your take-home. Its amount per check is saved with your salary in the Salary Profile. The annual tax, AGI and Roth IRA MAGI include it. The What-If tab's added deductions take the same choices.

- **Reference data:** the IRS Roth IRA income phase-out ranges, the Additional Medicare Tax thresholds you owe on (separate from the $200k your employer withholds at) and HDHP minimum deductibles for 2025 and 2026 are added to your tax data — you can edit them in Settings like the other IRS limits.

### Fixed

- **Paycheck FICA:** HSA money taken from your paycheck no longer counts as Social Security and Medicare wages (it goes in pre-tax for both under your employer's cafeteria plan), up to the HSA limit for your coverage and age less your employer's contribution. 401(k) deferrals still count, as the IRS requires.
- **Social Security over the wage base:** when your pay for the year passes the Social Security wage base, each check now shows the year's Social Security averaged over your checks, so a check × the number of checks matches your real take-home for the year. The year schedule still shows when it stops.
- **Bonus FICA:** the room left under the Social Security wage base is now based on your regular checks' FICA wages, and HSA money the bonus check takes is FICA-exempt within your remaining HSA room.
- **Annual tax includes your bonus:** the projected and year-end taxes (and the wage AGI under MAGI) were figured on salary alone. They now use household annual income — salary plus your bonus (the set amount if you've entered one, otherwise the formula) — with the money that comes out of the bonus check before tax.
- **Household Income card and Living Costs** now use the same household annual income as the taxes: salary plus the bonus you've set (or the formula if you haven't), in every view. When your set bonus differs from the formula, the formula figure is shown beside it. Living Costs' gross and net income now include the bonus, so its shares match the contributions it already counted from the bonus check. If a bonus isn't part of your budget, set "Bonus goes to: Extra spending" in that person's Bonus Estimate on the Paycheck page (like the extra-paycheck choice): Living Costs then shows its take-home as its own bar instead of counting it as unallocated.
- **Annual FICA** is now figured on FICA wages (after Section 125 deductions and payroll HSA money), Social Security capped per person, matching your paychecks.
- **Additional Medicare Tax** is now figured on your household's combined Medicare wages above your filing status's threshold (e.g. $250k married filing jointly) instead of each person's wages above $200k. The note about withheld vs owed now shows when either applies — including both of you under $200k but together over $250k — with the amount.
- **Effective tax rate** is now federal income tax ÷ AGI, the same way your tax history is figured; FICA is its own line.
- **Deductions:** a deduction can only be marked FICA-exempt if it is also pre-tax; an older row saved the other way is treated as FICA wages.
- **Tax data check (CI):** each table is now due by its own publication date in the right year (IRS/CMS by Nov 30 of the year before, HHS poverty lines by Jan 31), so the check no longer fails before the IRS has published, or asks for next year's poverty lines in October.

---

## [0.8.7] - 2026-10-13

This release is about making Ledgr's many numbers easier to act on. No database schema change; on start Ledgr adds the IRS total-additions limit (2025 and 2026) to its reference data and corrects the 2025 standard deduction if it still has the pre-OBBBA figure (an amount you changed yourself in Settings is left alone).

### Added

- **Milestones** (Insights → Milestones) — The Money Guy Show's and the Bogleheads' rules in one place, plus your own goals. Money Guy's seven wealth milestones (first $100k, Two Comma Club, liquid millionaire, financial independence…), the Financial Order of Operations ladder, the wealth formula, income-multiple checkpoints, 3/5/25 housing, a paid-off home by 60, 5/25 rebalancing bands and low cost. Each shows when you reached it (from your yearly history), when you're on pace to, and the next step. A timeline of what you've reached, "next up", and "since last year" sit at the top.
- **Your own goals and a checklist** on Milestones — any net-worth, liquid, retirement or brokerage target (optionally in today's dollars), and the things Ledgr can't see (deductibles covered, saving ahead, wills, term life, health-care directives).
- **Pick the rule where sources disagree:** Money Guy's or Fidelity's income-multiple checkpoints (the Retirement card's readiness row follows your pick), and Money Guy's 25% or r/personalfinance's 15% savings rule.
- **r/personalfinance rules:** mega backdoor Roth room (what's left of the IRS total-additions limit, if your plan allows after-tax contributions), near-term brokerage goals that belong out of stocks, and fund-by-fund expense ratios.
- **Recommendations** (Insights → Recommendations) — what to do next, ranked: anything urgent first, then by dollars a year. Grouped by your paycheck, moving money, safety, home, investing and keeping data current. Admins can snooze or dismiss one with a note on why; dismissed ones are listed at the bottom and come back if they become urgent. The dashboard Financial Checkup links to it with the count.
- **Keep data current** — stale snapshots, performance, basis and failed syncs now appear as recommendations too.
- **Quick search** — press Cmd/Ctrl-K to jump to any page by name or by what's on it ("HSA limit", "FI").
- **A plain-words summary** at the top of the Contributions page: your savings rate, the dollars behind it, and the next step.
- **Current glide path** (Benchmarks → Your mix vs your target) — your own target mix by age for what you hold today, separate from the retirement simulation's glide path, so the real portfolio can be held more conservatively on purpose. Your mix, rebalancing and recommendations compare against it once set.
- **Glide path chart** on Benchmarks: your target mix by age, with Vanguard's target-date stock share (shifted to your retirement age) to compare against.
- **Rebalancing says what to move**, in dollars: "Move about $X out of US Equities — $Y into US Bonds, $Z into TIPS", bringing every asset class back to target once any is outside its band.

### Changed

- **Sidebar:** a new **Insights** group (Recommendations, Milestones, Benchmarks, Contributions); Analysis is now **Planning** (Retirement, Tax Buckets, Tax Optimization, Relocation, Budget Scenarios).
- **Wealth score tiers** follow The Millionaire Next Door: Under Accumulator at half the expected net worth or less (it was anything under 1×), Average in between, Prodigious at 2×. The formula now uses gross pay rather than AGI, so heavy savers aren't flattered. Past years' scores and tiers update too.
- **Financial Checkup:** Employer Match is green only when you get the full match; the debt row now judges high-interest debt (paying the mortgage ahead is a later step); FI Progress shows your pace from the retirement projection.
- **Projected FI year** grows your FI number with inflation and counts cash, so it's no longer early; the Net Worth page reads it straight from the projection.
- **Savings rates** are shown and judged to whole percents — 24.9% shows (and counts) as 25%.
- **A joint family HSA** now shows its IRS limit on the Contributions page and card.
- **Your mix, costs and rebalancing count only SimpleFIN accounts linked to a Ledgr account**, so a duplicate or old connection no longer counts the same money twice; unlinked ones are listed as not counted.
- **Small asset classes** (a 1–2% cash target) are no longer flagged for being a fraction of a point off.
- **TIPS are purple and international bonds rose** in mixes and charts (were lime and teal), so neither is mistaken for US bonds or cash — including by colorblind readers.
- **Removed the year-by-year withdrawal-rate override** (it was already hidden from the override picker). No withdrawal strategy reads it, so it never changed the plan. Your initial withdrawal rate in the retirement settings is unchanged and still sets first-year spending for rate-based plans.

### Fixed

- **Coast FIRE no longer says "unreachable" for a plan that's on track** when no retirement budget is set — a one-cent rounding difference failed every age it tried.
- **2025 standard deduction** is now OBBBA's $31,500 married / $15,750 single / $23,625 head of household (was the pre-law $30,000 / $15,000 / $22,500) for 2025 tax figures. 2025 paycheck withholding still follows the IRS 2025 withholding tables, which were never updated.
- **Relocation with a move year** no longer understates the nest egg. The years after the move restarted at today's salary and today's prices, and the move year itself saved nothing; the move is now part of one projection from today. "Earliest you could move" uses the same calculation (and the portfolio it says you need is the balance going into that year, not the end of it), relocation expenses carry the same inflation as the rest of the projection, and they no longer replace your retirement budget in the first retirement year.

---

## [0.8.6] - 2026-10-13

Includes a database update that runs automatically on start; Ledgr saves a backup of your data first. Restoring a backup from an older version still works (pending-rollover rows from older backups are left out — that feature no longer exists).

### Added

- **Include-portfolio switch for the savings rate**, next to include-match. Both switches are now shared: flip either one anywhere and every savings rate and contribution total follows — Financial Checkup, the Contributions page and card, the Paycheck contribution snapshot, the Retirement card and the projection's Rate column. Admins' choice is saved for the household; viewers' stays in their browser.
- **Household time zone** (Settings → General → Household). The server now works out "today" — year-end snapshots, paycheck and budget dates, daily syncs — in your household's time zone instead of UTC, so dates near midnight land on the right day. An admin's browser fills it in on first visit.
- **Contributions from bonus check** — one switch in the Salary Profile replaces the two that said the same thing ("401(k) on bonus" and "Bonus counts toward contributions").

### Changed

- **Contribution figures agree everywhere.** The paycheck, the Contributions page and card, the Retirement card and the retirement projection now use one rule for money taken from bonus checks, and one savings-rate calculation. Rates show one decimal everywhere.
- **The employer match follows bonus-check contributions** everywhere, the paycheck included.
- **A pinned bonus** (bonus override on a Salary Profile) now applies to every figure for this year — contributions, the match and the savings rate — not just the paycheck. Projections still grow the formula bonus.
- **Per-account percentages show your payroll election** ("15% of pay") instead of dollars divided by salary.
- **The Retirement card and the Retirement page's Rate column count Retirement accounts only**, matching the Retirement page's balances and the Contributions page's Retirement total.
- **The Contributions page's Year-End and YTD figures** count joint accounts for the selected view and compare year-to-date money with pay earned so far.

### Removed

- The pending-rollover tracker on the Performance page (nothing has created rollovers since the ESPP calculator was removed in 0.8.5), and server endpoints no screen used.

### Fixed

- **Bonus 401(k) money was counted twice** on the Contributions page and card when both bonus switches were on.
- **Projections for two-earner households** applied contribution rates to total pay, bonus included, regardless of the bonus setting; fixed-annual contributions were projected at twelve times their amount.
- **Deleting a savings goal hid its sub-goals.** They now become top-level goals, and the database protects the link again (it was lost in the 0.8 upgrade).
- **Editing a loan or extra payment** didn't refresh the payoff line, Debt Payoff or the net-worth mortgage balance until reload.
- **The savings add-transaction and transfer forms** could submit a different fund than the one shown when the fund list changed while the form was open.
- **The Year-End estimate** could count a bonus check that had already been paid twice.

---

## [0.8.5] - 2026-10-12

Includes a database update that runs automatically on start; Ledgr saves a backup of your data first. Restoring a backup from an older version still works.

### Added

- Investments from SimpleFIN: holdings, transactions and fund details now come in from your linked accounts. Snapshots, Performance and cost basis can be filled from them — Ledgr suggests the numbers and you confirm.
- Accounts whose institution reports only a balance get contribution estimates from your paycheck setup.
- Money moved between your own accounts is recognized as a transfer, not new savings, with a one-click "moved between my accounts" for moves only one side reports.
- A deposit can be split by hand into your part, the employer's part and Roth.
- Benchmarks: compare your mix with a target-date fund for your retirement year (the default) or a blended option. Every major fund category shows in mix vs target, accounts holding several funds add them up in the account header, and several fund categories can count toward one asset class.
- A plan fund with no public data can use a suggested stand-in fund. Ledgr previews it and recommends whether to use it or enter the details yourself.
- Portfolio shows what moved since the last snapshot (money you added vs the markets), a live daily line after the last snapshot (also on Net Worth), and each account's SimpleFIN detail. Brokerage cost basis can be suggested from the average cost your institution reports.
- Retirement shows the returns you've actually had next to the returns the plan assumes.
- Contributions shows this year's money in so far, live, with a status for each account: On pace, Latest deposit differs, No recent deposit, or Estimated. Hover a status to see the latest deposit next to what your setup puts in.
- The Year-End Estimate counts what's already in, what's on its way, and the rest of the year at today's setup.

### Changed

- The dashboard combines related cards instead of stacking them:
  - Budget & Spending shows the budget summary and what's been spent this month.
  - Taxes moved into Household Income, and mortgage payoff progress sits under Net Worth.
  - Financial Checkup's Savings Rate opens into its breakdown.
  - Retirement is a wide card with Readiness and Growth benchmarks alongside.
- The savings rate counts joint accounts. In Actual YTD it compares the money in so far with the pay earned so far, and the Traditional / Roth / After-tax / HSA lines follow the selected view and add up to their group.
- Debt Payoff's "ahead" is measured against your original loan, refinancing included, matching the payoff line under Net Worth.
- A SimpleFIN account you've left unchecked no longer counts anywhere.

### Removed

- The ESPP purchase-period calculator, the Performance page's index column, and household transaction rules.

### Fixed

- The Year-End Estimate could show more than 100% of a limit (for example an IRA at 108%) when this month's contribution had already arrived.
- Joint accounts on the Contributions card showed the full-year plan in every view.
- Restoring a backup could fail partway through.
- SimpleFIN: institution names were missing for some connections, and a "date range was capped" notice was reported as an error.
- A holding that is itself a fund could be counted as a single stock in fund breakdowns.

---

## [0.8.4] - 2026-10-10

No database changes.

### Added

- Privacy mode: hide every dollar amount with the eye button at the bottom of the sidebar — handy when screen-sharing. Amounts become a handwritten-style scribble that looks different on every page load, and your choice is remembered in this browser. Percentages, dates and values you type into fields stay visible.
- A link below the System group opens your budget app (YNAB or Actual) in a new tab. Actual has a separate "External URL" field, since its Server URL is often a private address a browser can't open. The link is hidden until one is set.
- Tiingo connection in Settings → Integrations: save a free Tiingo API key for historical index and fund prices, groundwork for comparing your portfolio against market benchmarks. The key is checked with Tiingo before it's saved and stored encrypted.

### Fixed

- Budget push and preview used a stale amount for items linked to a Contribution Profile instead of the profile's current value.
- Editing contribution accounts in the budget could lose an update when several accounts shared one Contribution Profile.
- Pages could show "too many requests" errors during normal use, including while typing in the What-If tab.
- The simulation progress bar could keep running indefinitely if a simulation never finished; it now stops after about three minutes.
- Any signed-in user could read the stored settings of connected services (including credentials) through an internal settings endpoint. It is now admin-only and never returns credentials.
- For users who can't change settings (viewers, demo mode), the dashboard kept re-sending a request to fix the active Contribution, Salary and Retirement Profile several times a second and could show a stack of "didn't save" messages. It now tries once per page load.

---

## [0.8.3] - 2026-09-07

One additive, nullable column, no data loss: `retirement_profile_people.social_security_pia` (NULL on every existing row = not opted in). The migration changes nothing on its own.

### Added

- **Social Security PIA (Primary Insurance Amount) and claiming-age comparison.** Enter your Primary Insurance Amount from your SSA statement in Retirement → Social Security, and your benefit is now adjusted for claiming early or delaying past Full Retirement Age instead of assuming a flat, unadjusted monthly amount. Once entered, a new claiming-age comparison runs your real projection at every age from 62 to 70 and shows which one leaves you with the most money at the end of your plan, excluding any age that would run out your portfolio. For married couples, spousal benefits are calculated automatically — each person gets the greater of their own benefit or a share of their spouse's, correctly adjusted for both partners' ages and reduced for years before the other spouse has claimed.

### Changed

- Renamed "Scenario" to "Plan" throughout admin and account-permission screens, matching the terminology used everywhere else in the app.
- The portfolio Snapshot Balance editor is now locked by default — click the padlock to make a correction. Account order in a snapshot no longer reshuffles.

### Fixed

- Restoring certain backups could silently corrupt a handful of internal settings values, depending on which database the backup was taken from and restored into.
- Dates near midnight could land on the wrong calendar day depending on your timezone — this affected year-end snapshots and job start/end dates used in projections, and could shift a projected year boundary by one day. A `TZ` setting is now available for self-hosters to align server-side date handling with their household's timezone (see the deploy docs).
- The Social Security claiming-age comparison and the "delay Social Security" retirement-strategy suggestion now correctly account for how delaying affects a spouse's benefit, for married households.
- The withdrawal-bracket optimizer and the Social Security claiming-age comparison now use the retirement plan you're actually viewing, instead of always using your active plan, when looking at a different saved plan.

## [0.8.2] - 2026-09-05

Three additive columns, no data loss: `retirement_settings.withdrawal_routing_mode` (NOT NULL, defaults every existing row to `bracket_filling` — everyone's actual behavior today) plus nullable `withdrawal_order` and `withdrawal_splits` (NULL on every existing row = "use the built-in default"). The migration changes nothing on its own.

### Added

- **Tax Optimization page** (Analysis → Tax Optimization). Decision tools for the tax side of a retirement plan, all running the same deterministic projection engine the Retirement page uses (no separate tax model). A **Roth conversion explorer** that scores every one of the household's real marginal bracket rates as a conversion ceiling — the full comparison of lifetime tax vs. Traditional money left unconverted per ceiling, with the cost-minimizing one recommended — or an explicit target-rate schedule with a before/after break-even. A **withdrawal-strategy comparison** (traditional-first vs. brokerage-first vs. Bracket Filling, plus your actual current plan, side by side on lifetime tax). An **IRMAA cliff alert** for the years a Medicare-premium surcharge is paid or a conversion is capped to stay under one. Assumptions are edited via the same Retirement Profile controls the Retirement page uses — a change there saves to the profile and these tools recompute.
- **Withdrawal Routing is now a saved profile setting**, next to Discretionary Withdrawal Order in Taxes in Retirement — Bracket Filling (the tax-optimized default), Waterfall, or Percentage. Previously this only existed as a per-session toggle on the Retirement page that reset on every reload and wasn't visible anywhere else; the Tax Optimization page's withdrawal-strategy comparison could name a strategy the winner with no way to find or set it on your plan. The Retirement page's Configure toggle still lets you try a different mode for one session without changing what's saved.
- The withdrawal-strategy comparison now says when a named strategy is the same as your current plan, instead of showing two rows with identical numbers and no explanation.
- **Withdrawal order and percentage splits are now saved profile defaults too**, edited in Taxes in Retirement below Withdrawal Routing. The account draw order (which Traditional account Bracket Filling fills first; the full sequence Waterfall drains in) and the per-account splits Percentage mode uses were previously per-session only on the Retirement page and reset on reload — a household whose real choice was "Waterfall, brokerage first" had no way to make it stick. The Retirement page's Configure toggle still customizes them for one session without changing what's saved.
- **IRMAA-capped Roth conversions are now visible.** When IRMAA awareness is on, the engine caps a year's Roth conversion at the next Medicare-premium threshold; that used to leave no trace. The Tax Optimization page's IRMAA alert now counts those years and the advisor report adds a note ("N years had Roth conversions capped for IRMAA"). No change to any projected figure.
- **Fix a wrong balance in the latest portfolio snapshot.** Expand the newest snapshot in Snapshot History and click any balance to correct it. On save, that year's performance figures are re-derived and the corrected balances are queued for a resync to YNAB/Actual (see the Changed note below — the resync replaces this snapshot's prior entries, so there's nothing to reconcile). Latest snapshot only; a snapshot in a finalized year is left alone. Saving a snapshot for a date that already has one now shows a clear message instead of a raw error.
- **Save-draft on a new snapshot.** The New Snapshot form now autosaves to your browser as you go, so a half-finished snapshot survives a closed tab. Reopen it and a "Resume / Discard" prompt appears; Resume merges your entries onto the current account list. One draft per date, per browser.

### Fixed

- **Withdrawal-strategy comparison, Monte Carlo, and stress tests ignored several real household settings.** The strategy comparison (and the Monte Carlo run behind it) and the stress test each built their own decumulation config instead of using the same resolver every other projection surface uses — so a household with automatic QCD maximization, RMD smoothing, `rmdExcessHandling: "spend"`, brokerage-first discretionary withdrawal order, or a customized withdrawal order/splits got those settings silently reset to the engine's defaults for these three views only, while the Retirement page and Tax Optimization correctly reflected them. Also fixed a related caching bug: the strategy comparison's cache key omitted the household's tax settings and Withdrawal Routing mode entirely, so changing either did not invalidate a previously-cached comparison — it could keep serving a stale result computed under the old setting.
- **Contribution Profile data loss from the Paycheck page.** Editing a contribution or deduction value on the Paycheck page (in profile mode) rebuilt the profile's entire `contributionActiveFields` blob from a client-side query snapshot and wrote the whole thing back. If that snapshot was stale — e.g. right after a profile rename, which invalidates the query — the write silently wiped every account and deduction entry the snapshot didn't have, leaving the profile "Incomplete" with everything falling back to no value. The Paycheck page now uses the same field-level, server-side, transactional patch procedures (`setAccountActiveFields` / `setDeductionActiveFields`) the Contribution Profile Manager already moved to — it was the last caller still doing the full-blob rewrite.

### Changed

- **Portfolio snapshot budget-app sync is now an explicit button.** After you edit a snapshot balance (or add a new snapshot), the pending push to YNAB/Actual is triggered by a solid **Sync to {service}** button — in an amber action bar on the expanded snapshot row and in the page-level banner — instead of firing implicitly when you collapsed the row (which was easy to miss). A collapsed snapshot with unpushed edits now shows an amber "unsynced" badge next to its date. Nothing is pushed to your budget app until you click Sync.
- **One consistent way to rename a profile.** Budget, Contribution, Salary, and Retirement profiles are all renamed the same way now: click the profile's name in the list to edit it inline. Previously three of the four had a faint hover-only "rename" button in the list while two had a separate "Name" field in the editor pane — and Salary had no list-level rename at all. The Savings tab still has no rename (its rail reuses Budget profiles — rename them from the Budget → Profiles tab).
- **Decluttered the profile-list row.** The active profile's row (especially when it's API-synced) no longer crams the name, an ACTIVE pill, a long "⇄ ACTUAL → Standard" pill, and the clone/activate/delete controls onto one narrow line. The name now takes the space it needs and truncates; the sync indicator moved to the quieter detail line below; row controls reveal on hover/focus and wrap out of the way on the narrow rail.

## [0.8.1] - 2026-09-03

Accessibility, print, and internal-quality pass. No schema changes, no migration — a plain code release.

### Accessibility

- **Value cells that signal a number's sign with red/green** now pair the color with a non-color cue everywhere. Signed-value colors are centralized (`gainLossTextColor` / `overUnderTextColor`), the portfolio snapshot delta cells gained a ▲/▼ glyph and a screen-reader-only "increase/decrease from previous snapshot" label, and the budget diff cells keep their existing "over"/"under" text.
- **Keyboard focus is visible** on the nine transparent inline-editing inputs in the performance and portfolio editors that previously suppressed the focus outline with no replacement — now a `focus-visible` ring (keyboard only, not on mouse click).
- **Progress bars are exposed to screen readers** — the shared `ProgressBar` and the expenses budget-vs-actual bar now carry `role="progressbar"` with a name and value (previously a bare `<div>` with no semantics).
- **Chart line contrast** — the net-worth, portfolio-balance, simulation-median and total-withdrawal lines are now theme-aware so they clear the WCAG 1.4.11 3:1 minimum against the dark card background.

### Print

- Printing in dark mode no longer produces a dark, toner-heavy page — print forces a light color scheme.
- Amortization-schedule and net-worth-history table rows no longer split across a page break.

### Settings

- **IRS limit growth rate is now editable** (Settings → Reference Data → Return Rates). The projection engine grows IRS contribution limits by this rate each future year; it was previously a fixed, invisible 2%.

### Under the hood

- **Dual-DB parity test suite** (`tests/db/transforms-parity.test.ts`) — guards the Postgres-string vs SQLite-number boundary on every helper that reads a `decimal` column, a bug class that is invisible in CI (SQLite-only) and surfaces only in production.
- `prettier-plugin-tailwindcss` — Tailwind class order is now sorted and enforced on every commit.
- Recharts animation-disable is explicit on all chart components (was relying on a global reduced-motion CSS fallback).
- `performance/` page converted to the server-shell prefetch pattern (`page.tsx` + `performance-content.tsx`), matching `brokerage/` and `contributions/` — first paint now hydrates with data and persisted column state instead of snapping.
- **Batched budget-amount saves are now atomic** — a grid paste (and the add/remove-column and reorder operations) either lands whole or not at all, and a paste cell that can't be saved is now surfaced with a toast (and a failed save no longer fails silently to the console).
- **Failed-save toasts are now readable** — the app-wide mutation-error toast maps error codes (permission denied, not found, conflict, server error) to plain sentences and shows the first field issue for input-validation failures, instead of dumping a raw Zod/tRPC/database error string. Every router's user-facing `throw`s were converted to typed errors so their actionable messages survive the mapping; genuine internal invariants still show the generic line and are logged.
- Recharts is code-split out of the `analytics` and `upkeep/utilities` page chunks; four static page wrappers dropped an unnecessary `"use client"`.
- A failed optimistic mutation (essential-flag toggles, reorders) no longer shows two toasts; the app-wide handler is now the single source. Shared `RouterOutputs` type on `lib/trpc.ts` replaces a hand-copied result struct.
- Engine audit (R48) for calculations/assumptions with no UI or report surface — the IRS-limit-growth-rate finding is fixed above; the Print Advisor Report now also states an assumed annual brokerage-contribution increase when one is set; two smaller findings triaged to the backlog; none change projection math.

## [0.8.0] - 2026-09-03

> Rollup of everything since v0.7.0. For patch-level detail, see the v0.7.x entries below.

### Upgrading from v0.7.x

Pull the new image and restart — your database upgrades automatically. v0.8.0 squashes all v0.7.x migrations into a single baseline; the migration runner detects the v0.7 schema, writes a pre-upgrade backup, and re-applies the squashed schema in place with no manual steps and no data loss. There are no schema changes versus v0.7.11 — the squash is purely housekeeping.

### Profiles & Plans

- **Salary Profiles own the full pay picture.** Each profile now controls salary, bonus percentage and multiplier, pay schedule, W-4 withholding, and where a biweekly month's extra paycheck goes — everything that conceptually varies with a job change. Profiles are ordinary renamable, deletable rows (no more synthetic "default"), and salary/bonus history lives on the Historical page's Year-End table rather than on job records. Jobs are now pure employment structure.
- **Budget Profiles** support weighted modes with a real editor (e.g. 1 month Traveling + 11 months At Home), a Blended "typical month" column in the summary, and an annual total that includes savings. A profile can link to a Contribution Profile at creation.
- **Savings goal funding is entirely per budget profile** — no shared default a profile silently falls back to. The Savings Profiles sidebar shows Allocated and Unspent per profile, plus a live pool estimate and a "Reset all to zero" action.
- **Plans** pin which Budget Profile and Contribution Profile are active; every page respects the pinned profile consistently. "Clone to new" on Budget, Salary, and Contribution profiles. One edit-protection padlock now governs every profile editor across the Budget, Savings, and Paycheck pages, and the active / Plan-pinned / just-viewing states share one consistent look everywhere.
- A **"What-If" tab** on the Budget page — a sandbox to try a different salary, bonus, deductions, contribution accounts, and budget amounts together without disturbing your real data.

### Retirement projection engine

- **Roth-conversion RMD smoothing** — an opt-in setting that sizes conversions before RMD age to shrink future Required Minimum Distributions, with the multi-person household share calculated correctly.
- **Qualified Charitable Distributions** are modeled against each year's RMD (met / shortfall status in the tooltip) and are no longer capped at the RMD amount — a real QCD can legally exceed it, up to the annual per-person limit.
- **Age-65+ deductions** — the IRC §63(f) additional standard deduction and the temporary OBBBA senior deduction (2025-2028) are both applied per qualifying spouse per year, with the fixed OBBBA amount correctly left un-inflated.
- **Every inflation-indexed federal tax threshold now grows forward** in projections — ordinary brackets, standard deduction, LTCG brackets, IRMAA, and the ACA subsidy cliff — instead of being held flat in nominal dollars.
- **Multi-year Roth-bracket-target optimizer** for Bracket Filling mode — searches for the tax-bracket target with the best lifetime outcome and offers one-click Apply.
- **Bracket Filling vs. Waterfall** withdrawal routing both honor your configured account order; a "Discretionary withdrawal order" setting (Roth first vs. Brokerage first) with an ACA/IRMAA warning when the choice matters; the bracket-ceiling figure now shows in both modes.
- **Early-withdrawal-penalty handling** — projections no longer take penalized money even to cover a shortfall, with a per-account setting to explicitly allow the penalty on one account as a genuine last resort. Rule-of-55 and pre-59½ rules are modeled throughout.
- **Per-person raise rates**, per-person Social Security, and owner-aware account matching so two household members with an identically-named account (e.g. both "Long Term Brokerage") aren't credited to the wrong person.
- Tracked Roth basis with a bulk "Update Basis" entry screen; a "Rate-Seeded" scenario; a "Simple" tax mode alongside the per-account-aware "Advanced" mode; and simulation results that persist server-side across sessions and devices (standard and Coast FIRE).

### Retirement Profiles

- Save, name, and **duplicate whole sets of retirement assumptions** to compare plans side by side. Each profile can pin itself to a specific tax year's tables so an old projection reproduces exactly. Duplication now copies each household member's own values rather than the primary person's.

### Retirement reporting & UI

- **Print Advisor Report** — a purpose-built multi-page document (executive summary, Monte Carlo risk analysis, withdrawal-strategy narrative, ACA/IRMAA watchlist, action items, condensed year-by-year table), plus a plain "Print Chart & Table" export that no longer clips rows or columns.
- **"Why was this account used?" explanations** on the projection table and chart, the real lifetime-cost math behind a bracket-target choice, a **Lifetime Tax Paid** card, an editable Bracket Ceiling on the Assumptions band, projection-chart lines for portfolio withdrawal and Social Security income, a "breached floor" line on the Yearly Income Stability chart, Coast FIRE custom-age checks with real dollar shortfalls, and MAGI on the Household Income tile.

### Budget-provider sync

- **Per-service category links** — a household connected to both YNAB and Actual no longer loses one service's link when it links the other.
- **SimpleFIN Bridge** integration — a read-only daily balance pulse per linked account.
- Actual Budget: cash balances and API-linked savings-goal balances now populate correctly, the first-sync "Invalid month format" failure is fixed, push previews show the real current amount and the right service name, and goal-target pushes report honestly.
- Portfolio snapshot pushes post as reconciled; drift detection surfaces links whose underlying category no longer exists; bulk category-name sync no longer resets an item's sync direction or "last synced" time; converting a budget item to a savings goal (or back) carries over every connected service's link.

### Tax engine & data

- **2025/2026 federal withholding brackets corrected** — the two years' tables had drifted into copies of each other (married filers priced against 2026 in both years, single/HoH against 2025 in both), plus two transcription typos. All twelve tables are now transcribed from the IRS Publication 15-T PDFs.
- Contribution limits, tax brackets, LTCG brackets, IRMAA brackets, and **Federal Poverty Level figures** are all editable from Settings with year and filing-status versioning; a new "Tax law year" control pins a retirement profile to a specific year's tables; projections and paycheck estimates degrade gracefully when next year's data is only partially entered.
- Fixed LTCG rate selection exactly at a bracket boundary, a W-4-checkbox standard-deduction offset that overstated retirement tax, and an NIIT check that reused IRMAA's two-year-lookback income.

### Sinking funds & savings

- Mark a planned transaction **"settled"** once the real spend happens, per occurrence, instead of deleting it. Extra-paycheck routing no longer destroys savings-transaction history on every save, and savings projections no longer drop planned transactions dated later in the current month or double-count a month funded directly in YNAB/Actual.

### Other fixes

- Date and "today" defaults (new snapshot/transaction dates, backup filenames, "days old" figures) now use your local time instead of UTC.
- Closed Portfolio accounts zero their balance from the next snapshot rather than carrying the last known value forward; "inactive" is now "closed" (accounts) or "not funding a target" (contributions).
- Employer match supports a flat dollar amount alongside percent-of-contribution and fixed-annual, is calculated against combined Roth+Traditional contribution for a split account, and no longer renders as a nonsensical percentage on the unlinked-contributions banner.
- Dozens of profile-resolution consistency fixes so the Budget, Savings, Paycheck, Contributions, Expenses, Net Worth, Historical, Relocation, and dashboard views all agree on which Salary/Contribution/Budget profile and which mortgage loan are in effect.

### Under the hood

- **v0.8.0 migration squash** — 40 incremental v0.7.x migrations collapsed into a single `0000_v8_initial_schema` baseline per dialect, with a `v0.7_final` era probe added to the upgrade path.
- A central `resolveTaxParams` resolver is now the single code path every tax consumer uses to pick a tax-data vintage.
- A repo-wide pass replaced review-history citations in code comments with the technical reasoning they carried, backed by a new lint guard.
- Restoring a v0.7.0-tagged backup no longer fails with "Unknown schema version" — the v0.7 baseline tag and every subsequent v0.7.x tag are now registered, from a single shared list.

---

# Before v0.8

v0.7.11 and earlier: [docs/CHANGELOG-pre-0.8.md](docs/CHANGELOG-pre-0.8.md).
