# Ledgr — Working Style

## Rules & design

- **Authoritative rules:** `docs/RULES.md`. Grep it for the relevant rule when
  finishing non-trivial work — don't bulk-read.
- **Architecture reference:** `docs/DESIGN.md`. Read sections on demand, not the
  whole file.
- **Test inventory:** `docs/TESTING.md`. Tests live in `tests/` mirroring the
  source layout: `tests/calculators/`, `tests/routers/`, `tests/server/`,
  `tests/config/`, plus `tests/e2e/` for Playwright.

## When to consult the advisor

The `advisor` subagent (`.claude/subagents/advisor.md`) runs on Opus and exists
to push back. Use it before committing when:

- Changing anything in `lib/calculators/engine/` or `lib/db/schema*.ts`
- Editing `lib/config/account-types.ts` or any `lib/config/*tables*.ts` —
  these are the data-driven foundation the engine reads; a wrong helper here
  silently corrupts every consumer
- Editing permission gates (procedure types in routers)
- Deciding whether to roll back a release
- Stuck on the same bug after two wrong guesses
- About to break a RULES.md rule and think it's justified

Frame the question as "here's what I plan to do and why" — not "is this ok?"
The advisor should have enough context to disagree.

## Project shortcuts

- **Schema is generated.** `src/lib/db/schema-pg.ts` is the source of truth.
  After editing it, run `npx tsx scripts/gen-sqlite-schema.ts` to regenerate
  `schema-sqlite.ts`. Never edit `schema-sqlite.ts` directly — your change
  will be silently overwritten on the next regen.
- After touching engine modules, routers, or schema files, run
  `pnpm docs:verify` so DESIGN.md auto-gen counts stay accurate.
  Use `pnpm docs:update` to rewrite the markers in place. The PostToolUse
  hook in `.claude/settings.json` runs this automatically and fails loudly
  on drift.
- Prefer `pnpm test tests/calculators` (or another scoped path) over the full
  `pnpm test` suite. Run `pnpm lint` before committing.
