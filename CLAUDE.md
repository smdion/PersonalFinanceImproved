# Ledgr — Working Style

How to work in this repo. Code rules live in docs/RULES.md and DESIGN.md.

## Rules and design docs

Always check work against `docs/RULES.md` and `docs/DESIGN.md` before
finishing. Both are in the repo root `docs/` directory (not `.scratch/`).

## When to use subagents

Spin up an Agent instead of doing the work inline when:

- **Sweeps.** "Find every place that does X" across more than 3 files.
  Run multiple agents in parallel, one per concern. Have each return
  file:line hits only — no commentary.
- **Two independent questions.** If you need two things that don't depend
  on each other, send them as parallel Agent calls in a single message.
- **Noisy output.** If a command will dump hundreds of lines (test failures,
  build logs), let an agent run it and summarize. Keep the raw output out
  of our context.
- **Post-change review.** After any non-trivial change, spawn a fresh
  Explore agent to check the diff against RULES.md. A second pair of eyes
  that has no investment in the code just written.

Don't use an agent when one Grep or one Read will answer the question.

## When to consult the advisor

The `advisor` subagent (`.claude/subagents/advisor.md`) runs on Opus and
exists to push back. Use it before committing when:

- Changing anything in `lib/calculators/engine/` or `lib/db/schema*.ts`
- Editing permission gates (procedure types in routers)
- Deciding whether to roll back a release
- Stuck on the same bug after two wrong guesses
- About to break a RULES.md rule and think it's justified

Frame the question as "here's what I plan to do and why" — not "is this ok?"
The advisor should have enough context to disagree.

## Save tokens

- **Grep before Read.** Find the line number first, then read just that slice
  with `offset` + `limit`.
- **Don't re-read after Edit.** The harness tracks file state. Edit errors if
  it fails — no need to verify.
- **Don't echo tool output back.** Summarize what matters. The user already
  sees the raw output.
- **Read slices, not whole files.** Full-file reads are for files under ~300
  lines or when you genuinely need the whole picture.
