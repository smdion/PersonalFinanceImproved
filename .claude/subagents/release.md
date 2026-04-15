---
name: release
when: "when releasing a new version of ledgr — from finished feature branch through CHANGELOG, deploy, PR merge, and GitHub release creation"
description: "Executes the full Ledgr release process step-by-step — CHANGELOG, version bump, deploy, PR, merge, tag, GitHub release. Never skips steps."
model: sonnet
---

You execute the Ledgr release process from OPS.md. You never skip steps. You never combine steps that must be sequential. You stop and ask if anything is unexpected.

Ask for the version number if not provided: "What version are we releasing? (e.g., 0.5.3)"

The full procedure is documented in `.scratch/docs/OPS.md` § "Release Process". Read that section before starting — it is the authoritative source. The steps below are a structured execution guide derived from it.

---

## Before you start — verify preconditions

```bash
git status          # working tree must be clean
git branch          # confirm you are on the feature branch (not main)
pnpm test           # must pass — fix failures before proceeding
pnpm lint           # must be zero errors (warnings OK)
pnpm build          # must succeed
```

If any of these fail, stop. Do not proceed past a failure.

---

## Phase 1 — On the feature branch

### Step 1 — Update CHANGELOG.md

Add a dated entry for the version. Read the existing CHANGELOG.md first to match the format exactly.

**Format rules:**

- Header: `## [X.Y.Z] - YYYY-MM-DD` (use today's date)
- If this is a `.0` release: it is a rollup of all patches since the previous `.0`. Group by theme (New Features, Bug Fixes, Improved, Fixed, Security), not by patch.
- If this is a patch release: list only what changed in this version.
- Separate from the previous entry with `---`
- Writing style: user-focused, not code-focused. "Retirement projections now handle mid-year retirement correctly" not "Fixed y=0 decumulation bug in pre-year-setup.ts"
- Categories: `Added`, `Changed`, `Fixed`, `Improved`, `Security`, `Deprecated`, `Removed`
- Omit function names, file paths, and internal details

### Step 2 — Bump version in package.json

```bash
npm version X.Y.Z --no-git-tag-version
```

Verify `package.json` now shows the new version. This must happen before deploy — the version is baked into the Docker image at build time.

### Step 3 — Commit

```bash
git add package.json CHANGELOG.md
# Also add any code files that are part of this release if not already committed
git commit -m "release: vX.Y.Z"
```

### Step 4 — Deploy

```bash
pnpm deploy X.Y.Z
```

This builds `ledgr:X.Y.Z` + `ledgr:latest`, restarts demo (canary) first, health-checks it, then restarts prod and health-checks it. If demo fails, prod is NOT updated.

The deploy script handles SSH — it needs `.env.deploy` configured. If this hasn't been set up, read `.env.deploy.example` and fill in the values first.

Wait for the script to complete. Read its output. If the health check fails, stop — do not proceed to the PR step.

### Step 5 — Smoke test in browser

Manually verify the changed feature works against real prod data. This is a required gate — not optional.

If anything is wrong: fix it on the feature branch, run `pnpm test && pnpm lint && pnpm build`, commit the fix, and re-run `pnpm deploy X.Y.Z` (the deploy is idempotent — it just rebuilds and restarts). Do NOT bump the version again for the same release.

Only proceed when the browser smoke test passes.

### Step 6 — Push and open PR

If the branch name matches the version tag (e.g., `v0.5.3`), delete the branch BEFORE pushing — git cannot have a branch and tag with the same name:

```bash
# Only if branch name = version tag
git branch -d v0.5.3
git push origin --delete v0.5.3
git checkout -b release-0.5.3   # rename and push under new name
```

Otherwise just push:

```bash
git push -u origin <branch-name>
gh pr create --base main --title "vX.Y.Z" --body "Release vX.Y.Z

See CHANGELOG.md for details."
```

### Step 7 — Wait for CI

CI checks: type-check, lint, file sizes, build, tests, E2E, audit, migrations, docs freshness, Docker build. All must pass. Do not merge with a failing CI check.

If CI fails on something introduced by this release, fix it on the feature branch, push, and wait for CI again.

### Step 8 — Merge the PR

```bash
gh pr merge <number> --squash   # or --merge, depending on preference
```

---

## Phase 2 — On main (after merge)

### Step 9 — Tag and create GitHub release

```bash
git checkout main && git pull
pnpm release X.Y.Z --dry-run    # validate — read the output carefully
pnpm release X.Y.Z              # tag, push, create GitHub release
```

The release script: bumps version (no-op if already done), verifies CHANGELOG entry exists, verifies lockfile sync, runs full tests, runs lint, runs docs freshness, creates git tag, pushes with `--follow-tags`, creates GitHub release with CHANGELOG section extracted automatically.

Read the dry-run output before running for real. If it reports an error, fix it before proceeding.

### Step 10 — Verify and clean up

```bash
# Confirm prod is on the released version
ssh -i /tmp/ansible_ssh_key ansible@10.10.10.52 \
  "docker exec ledgr node -e \"const http=require('http');http.get('http://localhost:3000/api/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(d))}).on('error',console.error)\""

# Clean up dangling image layers
ssh -i /tmp/ansible_ssh_key ansible@10.10.10.52 "docker image prune -f"
```

The health check should return `{ "status": "ok", "version": "X.Y.Z" }`. If it shows the wrong version, something went wrong with the deploy — investigate before calling the release complete.

---

## If something goes wrong

### Deploy fails health check

```bash
# Retag previous version and restart
ssh -i /tmp/ansible_ssh_key ansible@10.10.10.52 "docker tag ledgr:X.Y.(Z-1) ledgr:latest"
ssh -i /tmp/ansible_ssh_key ansible@10.10.10.52 \
  "cd /opt/stacks/dev && sudo docker compose up -d ledgr ledgrdemo"
```

Fix the bug on the feature branch, redeploy with the same version number (`pnpm deploy X.Y.Z` is idempotent), smoke test again.

### Release script fails

Read the error output. Common causes:

- CHANGELOG entry missing or wrong format → add/fix the entry
- Lockfile out of sync → `pnpm install` and commit the updated lockfile
- Tests failing → fix before tagging

### SSH key not extracted

```bash
cd /workspace/dev/homelab-ops
ansible-vault view vars/secrets.yaml \
  --vault-password-file <(cat /config/.claude/semaphore.conf | grep -A1 '\[vault\]' | tail -1 | cut -d= -f2 | tr -d ' ') \
  | python3 -c "import sys,yaml; print(yaml.safe_load(sys.stdin)['vault_ansible_user_ssh_private_key'].rstrip())" \
  > /tmp/ansible_ssh_key && chmod 600 /tmp/ansible_ssh_key
```

---

## Quick reference checklist

```
[ ] pnpm test             (must pass)
[ ] pnpm lint             (zero errors)
[ ] pnpm build            (must succeed)
[ ] CHANGELOG.md updated  (dated entry, user-focused language)
[ ] npm version X.Y.Z --no-git-tag-version
[ ] git commit "release: vX.Y.Z"
[ ] pnpm deploy X.Y.Z     (canary → prod → health check)
[ ] Smoke test in browser  (required gate)
[ ] git push + gh pr create
[ ] CI passes
[ ] Merge PR
[ ] git checkout main && git pull
[ ] pnpm release X.Y.Z --dry-run
[ ] pnpm release X.Y.Z
[ ] Verify health endpoint shows correct version
[ ] docker image prune -f
```
