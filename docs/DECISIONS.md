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
- **IRMAA is charged on top of the budget by default;** a household may count it inside its budget instead. A new household starts with it on top; a stored setting keeps its value. This replaces the reading of the entry above that names IRMAA as always separate.
- **A year with 27 or 53 paydays uses the real paydays,** disclosed on screen.
- **Yearly tax figures ship as a tax-data update,** outside any Ledgr release, each figure cited to its published source. A release never waits on them.
- **The `version` permission manages backups of household data, not access.** An admin's restore carries the backup whole; another viewer's keeps today's logins, access settings and integration credentials.
- **Design work changes how information is shown, not what.** No content is removed or reduced without an explicit decision.

## Architecture

- **Absent is a state, not zero.** Missing data shows as missing, never as $0; 0 only when the data says none. A default in money code needs a real absent state, and a missing key that should exist throws or warns.
- **Refusal happens only at entry.** A save, or a restore or import that tells the user to update Ledgr, may refuse a value. Reading data already stored never refuses it or overwrites it; bad stored data is handled once, where it is read. This replaces every refusal of stored data on read.
- **$0 in a calculation, missing on screen.** A stored value Ledgr can't read or cover may enter a calculation as $0 only with a visible note naming it; a screen showing that value itself shows it as missing. Every budget reader makes the same choice. This bounds "Absent is a state, not zero" for stored data.
- **Unknown stored values are read, not converted.** A stored value this version doesn't know becomes the documented default where that default keeps the value's meaning, and is otherwise left out; either way a note names it. It stays stored, and a save merges it back. A CHECK constraint refuses new writes only: no migration converts a stored unknown value, and its reader stays lenient. This extends "Migrations convert any install", which covers known old shapes.
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
- **Counts only fall.** Lint counts, file sizes, copied code, accessibility violations and page budgets are ratchets: a cleanup lowers one in the same commit, and a raise is its own commit with the owner's OK, except a small raise (below).
- **Small raise inside an approved item.** Inside an item the owner has already approved, a file or recorded function size may rise by at most 3 lines in the item's own commit, listed under `Ratchet-raise:` with the item's id. Page budgets, lint and suppression counts and every other ratchet still stop, and a rise over 3 lines stops. This is the one exception to "Counts only fall" above.
- **A signed bound widens only by a new owner line.** A figure bound or size exception the owner signed is widened only by a new decision from the owner; the advisor may narrow one, never widen it.
- **A fix that applies a decided rule and moves no figure lands without sign-off.** When such a fix moves 0 test or demo figures, it needs no owner sign-off, and the CHANGELOG's Fixed section names the case it fixes.
- **Page budgets carry stated headroom:** each page's measured size at the release plus 2 KB, re-set once per release.
- **Small commits.** At most 400 changed `src/` lines, and at most 8 `src/` files in an engine or tax commit; a proven move or rename is exempt.
- **No release soak** (owner, 2026-11-09): a release is tagged once CI is green on `main`'s merge commit.
- **Ledgr stays provider-neutral for alerts:** a failing scheduled job posts to any JSON webhook (`LEDGR_ALERT_WEBHOOK_URL`); where it goes is the installer's choice.
- **Migrations convert any install.** Ledgr is public, so one install's data never proves a stored shape is absent: an old shape is converted by a migration and a backup transform, or its reader stays.
