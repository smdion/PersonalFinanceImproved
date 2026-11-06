/**
 * Behavior baseline, part d (v0.10.0; DECISIONS.md "Sync-write pins"): the
 * rows a sync writes. Recorded YNAB and Actual Budget responses
 * (`sync/ynab.json`, `sync/actual.json`: one invented budget, shaped as
 * each API answers) are replayed through the real clients and
 * `sync.syncAll`, and every row the sync adds or changes must equal
 * `__sync__/<service>.json`.
 *
 * The household is the baseline's screens-e2e B (households.ts) with a car
 * loan, every kind of mapping (cash, credit card, mortgage balance and
 * home value, a debt, an asset created from a tracking account, a
 * portfolio account pushed to), and both savings goals linked to budget
 * categories. It syncs on 2026-02-15 and again on 2026-03-07, so the
 * second sync also harvests February's cached month into savings history.
 *
 * What's pinned, per table: the rows the two syncs wrote (new or changed,
 * every column but timestamps and the encrypted connection config), and
 * how many rows they removed; then `sync.getPreview` after them (v0.10.3
 * plan commit 3, owner Q4: an added pin), which reads the feed the syncs
 * cached, in `__sync__/<service>.preview.json` without its timestamps.
 * These pin today's behavior, bugs included.
 * The baseline rule in router-baseline.test.ts governs these files too;
 * `LEDGR_BASELINE_WRITE=1` rewrites them for the deletion case only.
 */
import "../routers/setup-mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { resetActualWrapperGates } from "@/lib/budget-api/actual-client";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { REGENERATE } from "./router-suite";
import { tableRows, writtenRows } from "./table-rows";
import {
  PIN_DIRS,
  SYNC_DATES,
  prepareSync,
  replay,
  runSyncs,
  withoutTimestamps,
  type Service,
} from "./pin-runs";

const SYNC_DIR = PIN_DIRS.sync;
const household = HOUSEHOLDS.find((h) => h.key === "e2e-b")!;

describe.each<Service>(["ynab", "actual"])("sync writes: %s", (service) => {
  let ctx: Awaited<ReturnType<typeof createTestCaller>>;
  let written: ReturnType<typeof writtenRows>;
  let preview: unknown;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(SYNC_DATES[0]!) });
    vi.stubGlobal("fetch", replay(service));
    resetActualWrapperGates();
    ctx = await createTestCaller();
    const { caller } = ctx;
    const ids = await seedHousehold(caller, household);
    await prepareSync(caller, service, ids);

    const before = tableRows(ctx.db);
    await runSyncs(caller, service);
    written = writtenRows(before, tableRows(ctx.db));
    preview = withoutTimestamps(await caller.sync.getPreview({ service }));
  }, 60_000);

  afterAll(() => {
    ctx?.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes the pinned rows", () => {
    const file = path.join(SYNC_DIR, `${service}.json`);
    if (REGENERATE) {
      fs.mkdirSync(SYNC_DIR, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(written, null, 1)}\n`);
      return;
    }
    expect(written).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });

  it("previews the pinned figures from the cached feed", () => {
    const file = path.join(SYNC_DIR, `${service}.preview.json`);
    if (REGENERATE) {
      fs.writeFileSync(file, `${JSON.stringify(preview, null, 1)}\n`);
      return;
    }
    expect(preview).toEqual(JSON.parse(fs.readFileSync(file, "utf8")));
  });
});
