/**
 * Behavior baseline, part c (v0.10.0): every router query for 17 invented
 * households, on SQLite, in three files so they run in parallel. This file
 * runs the six review households with a paycheck;
 * router-baseline-retired.test.ts the four with none;
 * router-baseline-ledgers.test.ts the seven ledger households.
 * router-baseline-postgres.test.ts runs all 17 on PostgreSQL against the
 * same files.
 *
 * Each household (households.ts) is seeded through the app's write
 * procedures into a database migrated from empty, with the clock fixed at
 * BASELINE_NOW, simulations seeded and run at BASELINE_TRIALS trials, and
 * no network. Every query procedure (procedures.ts; the ones it skips are
 * listed there with the reason; investments.getRecentChanges, apiDocs.list
 * and contributionProfile.resolve are left out as deleted in v0.10.0
 * commits 28–31, as is the testing router, which has no query) is called, and its numbers (numbers.ts:
 * numbers only, never text, ids and timestamps left out) must equal
 * `__baseline__/<household>/<procedure>.json`. A procedure that threw is
 * recorded as `{ "$threw": 1 }` and must keep throwing. These files pin
 * today's behavior, bugs included: they say what the code does, not what
 * it should do.
 *
 * THE BASELINE RULE (v0.10.x, structure only):
 * - A structural commit leaves every file under __baseline__/
 *   byte-identical.
 * - A commit that deletes a procedure may remove that procedure's files,
 *   in the same commit, naming them in the commit body.
 * - Nothing else edits a baseline file. A figure that changes is a bug in
 *   the change (or a v0.11 fix that waits for v0.11).
 * - CI checks this against the merge base (scripts/check-ratchets.ts); an
 *   owner-signed re-record carries a `Baseline-rerecord:` line.
 *
 * Regenerating is only for the deletion case above, and only on SQLite:
 *
 *   LEDGR_BASELINE_WRITE=1 pnpm test tests/baseline/router-baseline.test.ts \
 *     tests/baseline/router-baseline-retired.test.ts \
 *     tests/baseline/router-baseline-ledgers.test.ts
 *
 * then check with `git diff --stat tests/baseline/__baseline__` that only
 * the deleted procedure's files changed.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { createTestCaller } from "../routers/setup";
import { defineRouterBaseline } from "./router-suite";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";

defineRouterBaseline({
  dialect: "sqlite",
  households: REVIEWED_HOUSEHOLDS.filter((h) => h.jobs.length > 0),
  wholeBaselineChecks: true,
  open: async () => {
    const { caller, cleanup } = await createTestCaller();
    return { caller, close: cleanup };
  },
});
