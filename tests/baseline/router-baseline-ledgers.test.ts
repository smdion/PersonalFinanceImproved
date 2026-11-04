/**
 * Behavior baseline, part c, on SQLite: the seven engine-ledger households.
 * The rule these files follow is in router-baseline.test.ts's header.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { createTestCaller } from "../routers/setup";
import { defineRouterBaseline } from "./router-suite";
import { LEDGER_HOUSEHOLDS } from "./households-ledgers";

defineRouterBaseline({
  dialect: "sqlite",
  households: LEDGER_HOUSEHOLDS,
  wholeBaselineChecks: false,
  open: async () => {
    const { caller, cleanup } = await createTestCaller();
    return { caller, close: cleanup };
  },
});
