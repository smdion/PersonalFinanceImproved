/**
 * Behavior baseline, part c, on SQLite: the four review households with no
 * paycheck (retired or early-retired); router-baseline.test.ts runs the
 * six with one. The rule these files follow is in its header.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { createTestCaller } from "../routers/setup";
import { defineRouterBaseline } from "./router-suite";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";

defineRouterBaseline({
  dialect: "sqlite",
  households: REVIEWED_HOUSEHOLDS.filter((h) => h.jobs.length === 0),
  wholeBaselineChecks: false,
  open: async () => {
    const { caller, cleanup } = await createTestCaller();
    return { caller, close: cleanup };
  },
});
