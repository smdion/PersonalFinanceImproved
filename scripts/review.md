# Code Review — Structured Prompt

**When:** Before merging any feature, every release, or every 2 weeks during
active development.

**How:** Feed this file to Claude as a prompt: `cat scripts/review.md`. Run only
the section(s) relevant to what you need — they are independent.

For financial-logic / calculator validation, use the dedicated
`scripts/review-financial-logic.md` instead.

## Which sections to run

| What you touched                                   | Run these sections                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| Routers (`src/server/routers/`)                    | §Pre-Merge Checklist + §RULES.md Compliance Sweep                        |
| Calculators or engine (`src/lib/calculators/`)     | §Pre-Merge Checklist + `review-financial-logic.md`                       |
| DB schema (`src/lib/db/schema-pg.ts`)              | §Pre-Merge + §RULES.md Compliance + verify migration safety manually     |
| Config (`src/lib/config/account-types.ts` etc.)    | §RULES.md Compliance Sweep (full) — config is the data-driven foundation |
| UI components only (`src/components/`, `src/app/`) | §Pre-Merge Checklist alone is usually enough                             |
| Whole-codebase audit (release time, biweekly)      | All sections + `review-financial-logic.md`                               |

---

## Pre-Merge Checklist

Run `git diff main...HEAD --stat` to see what files changed, then check each
item against the diff.

### Design compliance (per docs/RULES.md)

- [ ] No hardcoded category if-chains — uses `getAccountTypeConfig()` lookup
- [ ] No hardcoded category arrays — uses `getAllCategories()` / filtered helpers
- [ ] Display labels imported from `src/lib/config/display-labels.ts`, not local maps
- [ ] Settings live on their domain page, not centralized
- [ ] Shared state (budget mode, salary, contributions) flows through helpers, not duplicated
- [ ] New account types flow from `ACCOUNT_TYPE_CONFIG`
- [ ] One data shape, one render function (data-driven design)

### Code quality

- [ ] No `as unknown as` or `as any` without justification comment
- [ ] All tRPC procedures have Zod input validation
- [ ] Financial amount mutations use `zDecimal`, not bare `z.string()`
- [ ] Account type fields use `z.enum(accountCategoryEnum())`, not `z.string()`
- [ ] No empty catch blocks (silent error swallowing)
- [ ] No files over 1,000 lines
- [ ] Naming follows conventions: full words (no `pct`/`amt`/`acct`/`yr`/`idx`/`mo`),
      `*Props` for component props, correct verb prefix (`get*` / `list*` / `compute*`)

### Testing

- [ ] Calculator logic has unit tests with edge cases
- [ ] New tRPC procedures have integration tests (input validation, auth, error cases)
- [ ] Complex UI components have component tests
- [ ] Existing snapshot tests still pass
- [ ] Engine invariant tests still pass

### Security

- [ ] No raw SQL — uses Drizzle parameterized queries
- [ ] No unsanitized external input in shell commands
- [ ] External error messages truncated before client return
- [ ] Auth/RBAC applied to all new procedures
- [ ] UI permission gate matches the tRPC procedure type behind it
- [ ] Rate limiting on any new expensive operation

### Holistic check

- [ ] Change reflected across all affected pages (budget → savings → projection pipeline)
- [ ] CHANGELOG updated
- [ ] `docs/RULES.md` updated if a new convention was established
- [ ] `docs/TESTING.md` updated if new test files added

---

## RULES.md Compliance Sweep

Audit the full codebase against `docs/RULES.md`. For each section, scan for
violations and report `Rule Section | Violation | File:Line | Fix`.

1. **Data-Driven Architecture** — Find any `if`/`switch` on account category,
   budget category, or tax treatment that should be a config lookup. Check that
   all account behavior flows from `ACCOUNT_TYPE_CONFIG`. Any direct
   `=== '401k'` / `.includes('hsa')` is a violation. Any literal
   `['401k', '403b', 'hsa', 'ira', 'brokerage']` is a violation.

2. **Engine Modularity** — Verify the orchestrator (`engine/projection.ts`)
   contains no business logic. Check that no module imports from another
   module's internals (only via the barrel where applicable). Check that
   override resolution always goes through `override-resolution.ts`.

3. **The Holistic Rule** — Find any page/calculator that duplicates a query or
   computation that exists elsewhere. Check that budget mode, salary, and
   contribution state are read through shared helpers, not refetched directly.
   Find anything that reads `getLatestSnapshot()` for _year-level_ data instead
   of `buildYearEndHistory()`.

4. **Data Model Principles** — Check for computed values stored in DB outside
   the documented exceptions (`net_worth_annual`, finalized
   `annual_performance.lifetime*`, `annualReturnPct`). Check for hardcoded user
   data. Verify naming conventions (snake_case DB, camelCase code, canonical
   tax bucket keys `preTax`/`taxFree`/`hsa`/`afterTax`).

5. **Coding Conventions** — Check tRPC verb prefixes, type suffixes,
   abbreviation usage, state layer compliance (server/form/UI), import
   boundaries (components must not import from `server/`).

6. **Settings Belong on Their Pages** — Find any settings that migrated to a
   centralized Settings page instead of living on their domain page. The only
   acceptable centralized settings are People, IRS Limits, and Tax Brackets.

7. **Constants & Defaults** — Find numeric defaults (`0.04`, `0.07`, `200000`,
   etc.) inlined instead of imported from `src/lib/constants.ts`.

8. **Time Resolution** — Find any helper or calculator that calls `new Date()`
   internally instead of accepting `asOfDate` as a parameter.

9. **Permission & Security Gates** — Find any UI `hasPermission(...)` check
   whose mutation uses a different procedure type. Find any `/api/` route that
   bypasses `DEMO_ONLY` guards.

   **Before flagging a procedure-type violation, check the middleware.** Grep
   `src/server/trpc.ts` for guards (`demoOnlyGuard`, etc.) that exempt the
   path. The `demo.*` namespace specifically allows `protectedProcedure`
   mutations because `demoOnlyGuard` exempts it — see RULES.md
   §"Permission & Security Gates" rule 3 exception. Same logic for any
   "missing X check" finding: confirm middleware doesn't already provide X
   before reporting.

---

## Best Practices Sweep

Run a best-practices review on the codebase. Scan for each item, report
`Finding | Category | Severity | File:Line | Suggested Fix`. Only report NEW
findings (not items already tracked in `.scratch/docs/FEATURE-ROADMAP.md` §
Best Practices Backlog).

### Security

- [ ] Raw SQL string interpolation (anything not using Drizzle parameterized APIs)
- [ ] Unsanitized user input passed to `exec`/`spawn`/shell commands
- [ ] External API error messages returned directly to client without truncation
- [ ] Missing rate limiting on expensive procedures (Monte Carlo, sync, bulk operations)
- [ ] Secrets or credentials in source code (not vault)
- [ ] Missing auth/RBAC checks on new procedures

### TypeScript

- [ ] New `as unknown as` or `as any` casts (count and list each)
- [ ] Missing Zod validation on any tRPC procedure input
- [ ] `@ts-ignore` or `@ts-expect-error` comments (each with justification check)

### React patterns

- [ ] `key={index}` on any list that can be reordered, filtered, or have items added/removed
- [ ] `enabled: false` + manual `refetch()` (should be a mutation or boolean-gated `enabled`)
- [ ] `JSON.stringify` used for equality comparison
- [ ] Missing error boundaries on dashboard pages (every page should use `CardBoundary`)
- [ ] `useEffect` with missing or overly broad dependency arrays

### Performance

- [ ] Files over 1,000 lines (list with line counts)
- [ ] `Map`/`Set` created in render path and passed as props (not local-only lookups)
- [ ] Missing memoization on expensive computations passed as props
- [ ] N+1 query patterns in tRPC procedures (query inside a loop)

### Error handling

- [ ] Empty catch blocks (no logging)
- [ ] catch blocks that swallow and return success
- [ ] Missing error handling on async operations

**Output:** Add new findings to `.scratch/docs/FEATURE-ROADMAP.md` §
Best Practices Backlog; mark resolved ones as completed.
