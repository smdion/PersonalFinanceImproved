# Ledgr — Operations

How Ledgr is installed, deployed, backed up and released, in generic terms. Hosts, addresses, credentials and SSH details belong in your own deployment notes, never in this file.

## Install

The supported install is the Docker image with the sample compose file (README § Quick Start). SQLite is the default and needs no database server; PostgreSQL is equally supported (`docker-compose.postgres.yml`, `DATABASE_URL`).

1. Copy `.env.example` to `.env` and set `NEXTAUTH_SECRET`, `CRON_SECRET` and `ENCRYPTION_KEY` (README § Generate secrets).
2. `docker compose up -d`. On every start, `docker-entrypoint.sh` runs `db-migrate.ts`: a pre-upgrade backup, then pending migrations, then the reference-data seed, then the server.
3. Check `GET /api/health` reports `ok` and the expected version.
4. Put a reverse proxy in front for HTTPS and set `NEXTAUTH_URL` and `AUTH_TRUST_HOST=true` (README § Deployment).

## Deploy gate

A version is deployed before it is released, so a deploy problem is fixed on the version branch without using up a version number. Before `pnpm run deploy X.Y.Z` (with `run`: pnpm's built-in `pnpm deploy` is a different command):

- `package.json` holds the version being deployed (`deploy.sh` refuses a mismatch, or a dirty tree, unless `--force`).
- CI is green for the commit being deployed. `deploy.sh` checks before it builds (`scripts/ci-gate.ts`, through `gh`): the newest push run of `ci.yml` for HEAD's exact commit must have completed with success, with every job that commit's `ci.yml` defines (`ci` and `PostgreSQL`) run and green. Push runs only, since a release deploys from its `v*` push. The jobs run in parallel and `ci` needs all of them; the image build and the compose boot test (which signs in through the first-run wizard) run on every pull request and `v*` push, and on a push to `main` when the image's inputs changed (`scripts/ci-changes.sh`). A push that changes only docs, compared with its newest ancestor that has a green push run, skips the heavy steps; every job still runs and reports, and `docs:verify` still checks it. No run yet, a run still going, a red or skipped job, or `gh` not signed in: it refuses. `--skip-ci-gate` (not `--force`) deploys anyway after a printed warning; `--dry-run` runs the version, CI and clean-tree checks and stops before touching the host.
- If the release has a migration: it was tried against a copy of production data, and a database dump was taken (§ Backups).

`pnpm run deploy X.Y.Z` (`scripts/deploy.sh`, configured by a gitignored `.env.deploy`) builds the image on the host, restarts the demo container first and stops if it isn't healthy, then restarts production and checks `/api/health` reports the new version. It is safe to re-run with the same version. After it, check both containers' logs for the migration events and for errors, and smoke-test production.

## Backups

- **On startup** the migrator writes a JSON backup before applying any migration (in the data volume).
- **On demand:** the Versions page exports and imports backups; `pnpm backup:export` / `pnpm backup:import` do the same headless (`--dry-run` to check an import first). They and `pnpm db:migrate` read `.env` from the working directory (a variable already set wins). An export fails, naming the table, when a table can't be read; backup files are written owner-only (`0600`).
- **In a container:** the image has no `pnpm` or scripts, so export from the Versions page (or run `pnpm backup:export` from a checkout pointed at the same database). The migrator's pre-upgrade backups land in the data volume (`/app/data`, or `LEDGR_BACKUP_DIR`).
- **Keep `ENCRYPTION_KEY` with the backups.** A backup holds the integration credentials encrypted under the key in use when it was made; restored under another key, they don't decrypt and each integration must be set up again.
- **Off-site:** `scripts/encrypted-backup.sh` encrypts an export at rest and can copy it elsewhere; run it from the host's scheduler.
- **Before a release with a migration:** a full database dump (`pg_dump -Fc` on PostgreSQL, a copy of the database file on SQLite), checked to list its tables. It is the primary rollback.

## Rotating `ENCRYPTION_KEY`

`pnpm encryption:rotate` (`scripts/rotate-encryption-key.ts`) re-encrypts every stored integration credential, in `api_connections` and in the stored versions, under a new key, in one transaction: none of it lands unless all of it does. It reads the old key from `ENCRYPTION_KEY`, the new one from `ENCRYPTION_KEY_NEW`, and the database from `DATABASE_URL` or `SQLITE_PATH` (the environment or `.env`).

1. Stop Ledgr, so nothing writes a credential under the old key while the tool runs.
2. Generate the new key (`openssl rand -base64 32`) and dry-run: `ENCRYPTION_KEY_NEW=<new key> pnpm encryption:rotate --dry-run`. It prints what it would re-encrypt and changes nothing.
3. Run it: `ENCRYPTION_KEY_NEW=<new key> pnpm encryption:rotate`. A credential that decrypts with neither key stops it with nothing changed; a re-run after an interrupted one finishes a mixed state. Credentials stored before encryption are left for the app's next write.
4. Set `ENCRYPTION_KEY` to the new key in `.env`.
5. Start Ledgr and check an integration still connects.

The image has no `pnpm` or scripts: on a Docker install, stop the container and run the tool from a checkout of the same version (`pnpm install` there) against the same database: `DATABASE_URL` for PostgreSQL, or `SQLITE_PATH` pointing at the database file in the data volume. Backup files made before the rotation still hold credentials under the old key: keep the old key with them (§ Backups).

## Monitoring

- `GET /api/health` answers `ok` with the version, or `degraded` when the app's server code fails to load; the image's healthcheck calls it.
- `/api/health/detailed` (gated by `CRON_SECRET`) adds pool stats, integration status and each scheduled job's last result.
- `LEDGR_ALERT_WEBHOOK_URL`, if set, gets a JSON POST when a scheduled job starts failing, a reminder every 24 h while it still fails, and one post when it recovers (README § Optional — alerts has the fields). Any service that takes a JSON webhook works.

## Release Process

`package.json`'s version is the single source of truth (baked into the bundle and the image via `APP_VERSION`). Deploy, then release:

1. On the version branch: all checks green, a dated `## [X.Y.Z] - YYYY-MM-DD` CHANGELOG section, the version set in `package.json`.
2. Dump the database if a migration is pending (§ Backups), then `pnpm run deploy X.Y.Z` (§ Deploy gate).
3. Push the branch and open a pull request into `main`; wait for CI.
4. Merge only with the owner's explicit OK.
5. On `main`, at the merged commit: `pnpm release X.Y.Z --dry-run`, then `pnpm release X.Y.Z` (`scripts/release.sh`): refuses a release under 24 h after the last release tag unless `--hotfix "<reason>"` names a reason the CHANGELOG entry carries as a `Hotfix: <reason>` line (`scripts/release-soak.ts`; the dry run reports it), refuses unless `package.json` is already at X.Y.Z (the bump is a commit in the release PR, step 1), checks the CHANGELOG entry, that CI is green for the merged commit (`scripts/ci-gate.ts`, as `pnpm run deploy` does) and docs, tags `vX.Y.Z`, pushes the tag only (never a branch: `main` takes changes through a PR) and creates the GitHub release from the CHANGELOG section.

## Rollback

- **No migration in the release:** retag the previous image as `latest` and restart. `deploy.sh` keeps the current and the previous version's tag and prunes only older tags, dangling images and build cache; old images are also pruned on a schedule, so if it's gone, rebuild that version from its git tag.
- **With a migration:** stop the app, restore the pre-deploy dump, deploy the previous version from its tag, start. Never roll back the image alone: the old code would meet a schema it doesn't know.
- Never import the backup an older image writes at startup after rolling back with it; use the dump or a Versions-page export.

## Migration squashes

A squash folds a finished release line into one `0000_vN_initial_schema`
baseline, **generated from that line's last release** (a worktree at its
tag) — never from a schema that includes the new release's changes, whose
`ADD COLUMN`s a replay against an existing table would silently skip. The
new release's own migrations stay incremental after the baseline. Rules:

- Carry the baseline's hand-edited section forward (the profile seed) and
  no data statements from the squashed migrations.
- The generated snapshot must equal the old line's last snapshot apart from
  `id`/`prevId`; `drizzle-kit check` and `generate` report no changes.
- Installs older than the squashed line's last release are **refused**
  (`assertSupportedUpgradePath`: every table and column of the baseline's
  snapshot, checked before any backup or change — not swallowed). They
  update to that release first.
- The squash replay is one transaction ending in a check that every table
  and column of the latest snapshot exists; a failure stops startup with
  nothing changed.
- Keep every old tag and hash (backups name them). The current line's tags
  and file hashes are read from the journal, which the squash replaces, so
  first freeze the outgoing line's tags into `V08_SCHEMA_TAGS`
  (`backup-transforms.ts`) and its hashes into `PRE_V09_MIGRATION_HASHES`
  (`db-migrate.ts`); the two journal-pin tests fail otherwise.
- Verify on a restored prod dump, a fresh install from the new chain and one
  from the old chain (`pg_dump -s`, by name), both dialects, plus a refused
  older install.
