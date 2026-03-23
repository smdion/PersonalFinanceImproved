# Pre-Merge Review Checklist — Structured Prompt

**When:** Before merging any new feature or significant change.
**How:** Feed this file to Claude as a prompt: `cat scripts/review-pre-merge.md`

---

Run the pre-merge checklist for the current branch against main.
First, run `git diff main...HEAD --stat` to see what files changed, then check each item.

## Design Compliance

- [ ] No hardcoded categories — uses config lookup
- [ ] Follows data-driven design (one data shape, one render function)
- [ ] Settings live on their domain page, not centralized
- [ ] Uses shared state (budget mode, salary, contributions) — not duplicated
- [ ] New account types flow from ACCOUNT_TYPE_CONFIG

## Code Quality

- [ ] No `as unknown as` or `as any` without justification comment
- [ ] All tRPC procedures have Zod input validation
- [ ] No empty catch blocks
- [ ] No files over 1,000 lines
- [ ] Naming follows conventions (full words, correct verb prefix, typed Props)

## Testing

- [ ] Calculator logic has unit tests with edge cases
- [ ] New tRPC procedures have integration tests (input validation, auth, error cases)
- [ ] Complex UI components have component tests
- [ ] Existing snapshot tests still pass
- [ ] Engine invariant tests still pass

## Security

- [ ] No raw SQL — uses Drizzle parameterized queries
- [ ] No unsanitized external input in shell commands
- [ ] External error messages truncated before client return
- [ ] Auth/RBAC applied to all new procedures
- [ ] Rate limiting on any new expensive operation

## Holistic Check

- [ ] Change reflected across all affected pages (budget -> savings -> projection pipeline)
- [ ] CHANGELOG updated
- [ ] RULES.md updated if new conventions established
- [ ] TESTING.md updated if new test files added
