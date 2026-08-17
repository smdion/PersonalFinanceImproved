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

## Local docs & planning

`.scratch/docs/INDEX.md` (gitignored, not shipped) is the index for everything not covered above: `TODO.md`/`FEATURE-ROADMAP.md` (what's next), `OPS.md` (deploy/release/CI/security), per-feature implementation plans, and the other five subagents beyond `advisor` (`planner`, `release`, `reviewer`, `schema-reviewer`, `test-writer`). Check it before starting new feature work or asking "has this already been designed."

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
