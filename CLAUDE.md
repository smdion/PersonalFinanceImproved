# Ledgr — Working Style

## Rules & design

- **Authoritative rules:** `docs/RULES.md`, imported below: every session has
  all of it.
- **Architecture reference:** `docs/DESIGN.md`. Read sections on demand, not the
  whole file.
- **Code conventions:** `CONTRIBUTING.md`.
- **Test inventory:** `docs/TESTING.md`. Tests live in `tests/` mirroring the
  source layout, plus `tests/e2e/` for Playwright.
- **Install, deploy, backups, release:** `docs/OPS.md` (generic; host
  specifics stay in `.scratch/docs/ops/OPS.md`).

@docs/RULES.md

## The working loop

```
change → stage → pnpm gate → fresh reviewer → commit → push → CI → deploy
```

1. **Before risky work only:** the advisor (below), on whether the approach
   is sound.
2. **Change one behavior.** A behavior change starts from a failing test.
3. **Stage it and run `pnpm gate`**: lint, the type-aware lint and format
   on the staged files, the type-check, `tests/lint` and the tests related
   to the staged files.
   Fix every failure before review.
4. **Fresh review.** Spawn the `reviewer` agent with one line of intent and
   the gate's output. Never give it the plan, the advisor's report, your
   reasoning or an earlier round. It answers PASS, or BLOCK citing a rule.
   On a BLOCK, fix, re-stage, re-run the gate and spawn a new reviewer. Two
   rounds at most. After a second-round BLOCK you agree with: a docs- or
   staging-only fix lands as committed; a code fix gets one more fresh
   reviewer. Only a BLOCK you disagree with goes to the owner.
   Needs review: any staged change to `src/`, unless it is under 20 changed
   lines and outside the engine, `lib/config`, `lib/db`, router procedure
   types and tax data. Tests-only, docs-only and generated changes need none.
5. **Commit, push.** CI runs on every push; deploy only after it is green.

## AI session rules

These hold for every session, the cleanup included. No hook enforces them;
the reviewer and the owner do.

- Every change goes through the loop above; nothing in `src/` is committed
  without a PASS (or the owner's call after two rounds).
- **Second fix:** a second fix in one function within 30 days names the
  missing concept (`Concept:` trailer, or `Concept: none, <reason>`) before
  the code is written; a third goes to the advisor first.
- **No growth:** no function over 150 lines grows, and no file grows past its
  recorded size.
- **Commit size:** at most 400 changed `src/` lines, and at most 8 `src/`
  files in an engine or tax commit. A pure move or rename carries a
  `Mechanical:` line and is exempt.
- **Shape pass on bug fixes:** why was the bug possible, and where else does
  it exist? Fix the cause there, not one call site.

## When to consult the advisor

The `advisor` subagent (`.claude/agents/advisor.md`) runs on Opus and exists
to push back. Use it before committing when:

- Changing anything in `lib/calculators/engine/`, `lib/db/pg/*.ts` or `lib/db/schema*.ts`
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

`.scratch/docs/INDEX.md` (gitignored, not shipped) is the index for everything not covered above: `TODO.md`/`FEATURE-ROADMAP.md` (what's next), `ops/OPS.md` (this household's hosts, deploy, CI, security), per-feature implementation plans, and `advisor`'s four sibling subagents in `.claude/agents/` (`release`, `reviewer`, `schema-reviewer`, `test-writer`). Check it before starting new feature work or asking "has this already been designed."

## Project shortcuts

- **Schema is generated.** The PostgreSQL schema is the source of truth:
  tables live by domain in `src/lib/db/pg/*.ts`, re-exported by
  `src/lib/db/schema-pg.ts` (a new domain file gets an `export *` line
  there). After editing, run `npx tsx scripts/gen-sqlite-schema.ts` to
  regenerate `src/lib/db/sqlite/` and `schema-sqlite.ts`. Never edit those
  directly — your change will be silently overwritten on the next regen.
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
