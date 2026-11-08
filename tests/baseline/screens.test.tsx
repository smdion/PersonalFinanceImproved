// @vitest-environment happy-dom
/**
 * Behavior baseline, screens (v0.10.4 commit 2): what each page shows for
 * three invented households, so a UI change that moves a figure, a label,
 * a row or their order fails here.
 *
 * Each route's content component is mounted in happy-dom with tRPC mocked
 * (../components/trpc-mock). Its queries are answered by the same
 * procedures `__baseline__/<household>/*.json` pins, on the household
 * seeded as the router baseline seeds it, called with the page's own input
 * and passed through JSON as the app's link does (screen-mount.tsx says why
 * not from the files). The clock is the router baseline's, a Simulation's
 * unset seed is 31, privacy mode is off, the user is an admin. The pin,
 * `__screens__/<household>/<route>.txt`, is the visible text in document
 * order (screenText): one line per block element, `.sr-only` and
 * `aria-hidden` left out, whitespace collapsed, a control's shown value in
 * brackets. Charts render at zero size in happy-dom, so a chart's own
 * labels aren't pinned; its card's are. No tab is opened and no row
 * expanded: each page as it first shows.
 *
 * The households (screen-routes.tsx), between them reaching every page's
 * populated state that any baseline household reaches:
 * - e2e-b: two earners, a mortgage, savings goals, a joint brokerage; the
 *   only one with a mortgage (House, Liabilities' loan) and a full paycheck;
 * - ws-h2: head of household, semimonthly pay; the only one with debts
 *   (Liabilities' other debts);
 * - e2e-d: an early-retired couple, one IRA held in four parts (accounts in
 *   parts on Portfolio and Net worth, a Retirement page already drawing).
 * No household has a budget API connection, a utility or a saved version,
 * so Expenses, Utilities and Versions are pinned in their empty states.
 *
 * THE BASELINE RULE applies as for __baseline__/ (router-baseline.test.ts):
 * a structural commit leaves every file under __screens__/ byte-identical;
 * a moved screen pin stops the commit. The first pins were owner-signed as
 * additions (v0.10.4 Q2, 2026-11-07). Regenerating is only for an
 * owner-signed change:
 *
 *   LEDGR_BASELINE_WRITE=1 pnpm test tests/baseline/screens.test.tsx
 *
 * which writes the files and also prints each one between `@@screen <path>`
 * and `@@end` lines (a run on the test VM writes there, not here).
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import "../setup-component";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ComponentType, ReactNode } from "react";
import { cleanup } from "@testing-library/react";
import { HOUSEHOLDS } from "./households";
import { REGENERATE } from "./router-suite";
import {
  freezeScreenClock,
  mountPage,
  openHousehold,
  screenProviders,
  screenText,
  unrecorded,
  type ScreenHousehold,
} from "./screen-mount";
import { SCREEN_ROUTES, SCREEN_HOUSEHOLDS } from "./screen-routes";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./screen-mount")).screenTrpc(
    (await import("../components/trpc-mock")).trpc,
  ),
}));

// A Simulation the page runs without a seed gets a random one: fixed here,
// as procedures.ts fixes its own (seed 31), so the pins don't move by run.
vi.mock("@/server/services/projection/projection-cache", async (orig) => ({
  ...(await orig<
    typeof import("@/server/services/projection/projection-cache")
  >()),
  generateSeed: () => 31,
}));

const SCREENS_DIR = path.join(__dirname, "__screens__");
const WRITE = REGENERATE;
/** Set to print each page's unanswered queries (`@@gaps` lines). */
const SHOW_GAPS = process.env.LEDGR_SCREENS_GAPS === "1";

freezeScreenClock();

describe.each(SCREEN_HOUSEHOLDS.map((key) => [key] as const))("%s", (key) => {
  const household = HOUSEHOLDS.find((h) => h.key === key)!;
  let h: ScreenHousehold;
  let Providers: ComponentType<{ children: ReactNode }>;

  beforeAll(async () => {
    h = await openHousehold(household);
    Providers = await screenProviders();
  }, 120_000);
  afterAll(() => h.close());

  it.each(SCREEN_ROUTES.map((r) => [r.route, r] as const))(
    "%s",
    async (route, r) => {
      unrecorded.clear();
      h.gaps.clear();
      const Page = await r.load();
      const container = await mountPage(h, Page, Providers);
      const text = screenText(container);
      cleanup();
      if (SHOW_GAPS)
        console.log(
          `@@gaps ${key}${route}\n${[...unrecorded, ...h.gaps].join("\n")}\n@@endgaps`,
        );
      const file = path.join(SCREENS_DIR, key, `${r.file}.txt`);
      if (WRITE) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        console.log(`@@screen ${key}/${r.file}.txt\n${text}@@end`);
        return;
      }
      expect(fs.existsSync(file), `no screen pin ${key}/${r.file}.txt`).toBe(
        true,
      );
      expect(text).toBe(fs.readFileSync(file, "utf8"));
    },
    60_000,
  );
});

it("has one pin per household and route, and no other", () => {
  if (WRITE) return;
  const expected = SCREEN_HOUSEHOLDS.flatMap((key) =>
    SCREEN_ROUTES.map((r) => `${key}/${r.file}.txt`),
  ).sort();
  const onDisk = fs.existsSync(SCREENS_DIR)
    ? fs
        .readdirSync(SCREENS_DIR)
        .flatMap((key) =>
          fs.readdirSync(path.join(SCREENS_DIR, key)).map((f) => `${key}/${f}`),
        )
        .sort()
    : [];
  expect(onDisk).toEqual(expected);
});
