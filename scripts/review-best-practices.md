# Best Practices Review — Structured Prompt

**When:** Every release, or every 2 weeks during active development.
**How:** Feed this file to Claude as a prompt: `cat scripts/review-best-practices.md`

---

Run a best practices review on the codebase at /workspace/dev/personalfinance.
Check for these categories. For each, scan the ENTIRE codebase and report findings.

## Security

- [ ] Raw SQL string interpolation (anything not using Drizzle parameterized APIs)
- [ ] Unsanitized user input passed to exec/spawn/shell commands
- [ ] External API error messages returned directly to client without truncation
- [ ] Missing rate limiting on expensive procedures (Monte Carlo, sync, bulk operations)
- [ ] Secrets or credentials in source code (not vault)
- [ ] Missing auth/RBAC checks on new procedures

## TypeScript

- [ ] New `as unknown as` or `as any` casts (count and list each)
- [ ] Missing Zod validation on any tRPC procedure input
- [ ] `@ts-ignore` or `@ts-expect-error` comments (list each with justification check)

## React Patterns

- [ ] `key={index}` on any list that can be reordered, filtered, or have items added/removed
- [ ] `enabled: false` + manual `refetch()` (should be mutation or boolean-gated enabled)
- [ ] `JSON.stringify` used for equality comparison
- [ ] Missing error boundaries on dashboard pages (every page should use CardBoundary)
- [ ] `useEffect` with missing or overly broad dependency arrays

## Performance

- [ ] Files over 1,000 lines (list with line counts)
- [ ] Map/Set created in render path and passed as props (not local-only lookups)
- [ ] Missing memoization on expensive computations passed as props
- [ ] N+1 query patterns in tRPC procedures (query inside a loop)

## Naming (per RULES.md)

- [ ] New abbreviations (`pct`, `amt`, `acct`, `yr`, `idx`, `mo`) — not in legacy code
- [ ] tRPC procedures with wrong verb prefix (get\* for computations, etc.)
- [ ] Bare `interface Props` instead of `ComponentNameProps`
- [ ] Boolean variables/props missing `is*`/`has*`/`should*` prefix

## Error Handling

- [ ] Empty catch blocks (no logging)
- [ ] catch blocks that swallow and return success
- [ ] Missing error handling on async operations

## Data-Driven Design (per RULES.md)

- [ ] Hardcoded category if-chains (should use config lookup)
- [ ] Hardcoded category arrays (should use getAllCategories() helpers)
- [ ] Display labels not coming from config modules
- [ ] Inline account type logic instead of ACCOUNT_TYPE_CONFIG

Report as a table: Finding | Category | Severity | File:Line | Suggested Fix
Only report NEW findings (not items already tracked in FEATURE-ROADMAP.md § Best Practices Backlog).

**Output:** Add new findings to `FEATURE-ROADMAP.md § Best Practices Backlog`, mark resolved ones as completed.
