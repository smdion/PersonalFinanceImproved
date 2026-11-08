# Ledgr — Decisions

Settled product and architecture choices, most with their reason. Check here before reopening one. The rules that follow from them are in [RULES.md](RULES.md); how things are built is in [DESIGN.md](DESIGN.md). A decision changes only by a new entry here that says what it replaces.

## Product

- **Any household, not one.** Ledgr answers "are we on track?" for a household of any shape: one earner or two, any filing status, working or retired. Nothing in code or user text assumes one shape, and no calculation is tuned to one household's numbers.
- **SQLite is the default, supported install;** PostgreSQL is equally supported. Neither is "dev only", and every release is tested on both.
- **Budget apps are equals.** YNAB and Actual Budget are equal citizens: every budget feature, fix and test covers both, whichever one a household uses. A provider that can't be tested live is held by a shared conformance suite run on recorded responses and the provider's published API spec.
- **One term per meaning.** "Plan" is a saved set of the four profiles (Salary, Contribution, Budget, Retirement); "Projection" is the retirement forecast; "Retirement budget" is yearly spending in retirement; "Budget" alone is today's budget. The UI says "Simulation", never "Monte Carlo", and a profile is "active", never pinned, overridden or customized.
- **Each profile is its own world.** No profile is a default, main or baseline one; a Plan holds no values of its own, only which profiles are active.
- **Plan-wide dates show the year,** with each person's age on hover, named. Metrics defined on age (income multiples, the wealth formula) keep the household's average age.
- **One bar for the Simulation: 90%,** judging Portfolio Survival only. Other comparisons are shown, not pass/fail.
- **Everything is in the budget unless Ledgr names it as separate** (an IRMAA surcharge, a lump-sum outflow, an entered premium).
- **A year with 27 or 53 paydays uses the real paydays,** disclosed on screen.
- **Yearly tax figures ship as a tax-data update,** outside any Ledgr release, each figure cited to its published source. A release never waits on them.
- **The `version` permission manages backups of household data, not access.** An admin's restore carries the backup whole; another viewer's keeps today's logins, access settings and integration credentials.
- **Design work changes how information is shown, not what.** No content is removed or reduced without an explicit decision.

## Architecture

- **Absent is a state, not zero.** Missing data shows as missing, never as $0; 0 only when the data says none. A default in money code needs a real absent state, and a missing key that should exist throws or warns.
- **Behavior fields, not identity predicates.** Code asks what an account type does (a field in `lib/config/account-types.ts`), never which type it is. The engine may dispatch on the shape of a balance (`balanceStructure`).
- **Config declares, code executes.** Adding an account type is one config entry; tax tables and limits are data, versioned by year.
- **External responses are parsed before anything is written.** A response from another service is checked against its schema at the boundary.
- **The UI never imports server code, types included.** A router's result type reaches the UI as `RouterOutputs`.
- **A shared read moves to `server/data/` only with two readers or a stored-JSON parse;** otherwise it stays with its procedure. Composition that needs I/O lives in `server/services/`.
- **Business logic lives in `lib/pure/`,** one folder per area, with the projection engine in `lib/pure/engine/`.
- **Names are full words,** and a query's name starts `get`, `list` or `compute`. Stored keys, response keys and external API fields keep their spelling: renaming one changes a shape.
- **A number that can't change isn't a magic number.** `12` months in a year is written plainly.

## Change and release

- **Structure-only releases.** A release line that reshapes the code (v0.10.x) moves no figure: wording and label merges ride in their own commits, and any change that moves a figure waits for a release that states its cause in dollars.
- **Counts only fall.** Lint counts, file sizes, copied code, accessibility violations and page budgets are ratchets: a cleanup lowers one in the same commit, and a raise is its own commit with the owner's OK.
- **Page budgets carry stated headroom:** each page's measured size at the release plus 2 KB, re-set once per release.
- **Small commits.** At most 400 changed `src/` lines, and at most 8 `src/` files in an engine or tax commit; a proven move or rename is exempt.
- **A release soaks for 24 hours** after the last one, unless it is a hotfix, whose reason goes in the CHANGELOG.
- **Ledgr stays provider-neutral for alerts:** a failing scheduled job posts to any JSON webhook (`LEDGR_ALERT_WEBHOOK_URL`); where it goes is the installer's choice.
- **Migrations convert any install.** Ledgr is public, so one install's data never proves a stored shape is absent: an old shape is converted by a migration and a backup transform, or its reader stays.
