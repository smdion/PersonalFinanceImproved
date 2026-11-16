/**
 * Two paths to one year-0 figure, pinned until EN1.UI joins them: the
 * engine's starting money is the opening parts' totals (`openingTotals`),
 * while the payload still sums the same snapshot rows into
 * `portfolioByTaxType` and `portfolioByAccount` (`computeTaxBucketBreakdown`)
 * for the Tax Buckets view and the metadata. Seeds each baseline household
 * the way the router baseline does (router-suite.ts) and asserts the two
 * agree to the cent.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { seedHousehold } from "./seed";
import { HOUSEHOLDS } from "./households";
import { buildEnginePayload } from "@/server/services/projection/engine-payload/build-engine-payload";
import { fetchRetirementData } from "@/server/services/projection/engine-payload/load";
import { openingTotals } from "@/lib/pure/engine/opening-state";
import { roundToCents } from "@/lib/utils/math";

/** The router baseline's clock (router-suite.ts). */
const BASELINE_NOW = new Date("2026-03-07T18:00:00.000Z");

/** Every number to the cent (and -0 as 0). */
const cents = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_k, v: unknown) =>
      typeof v === "number" ? roundToCents(v) || 0 : v,
    ),
  );

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network disabled in baseline"))),
  );
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the opening parts' totals are the payload's tax buckets and per-category balances", () => {
  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s",
    async (_key, household) => {
      const { caller, rawDb, cleanup } = await createTestCaller();
      try {
        const ids = await seedHousehold(caller, household);
        const data = await fetchRetirementData(rawDb, {
          contributionProfileId: ids.contributionProfile,
        });
        const payload = await buildEnginePayload(rawDb, data, {
          asOf: new Date(),
          contributionProfileId: ids.contributionProfile,
        });
        expect(payload, `${household.key}: no payload`).not.toBeNull();
        const { balances, accountBalance } = openingTotals(
          payload!.baseEngineInput.individualAccounts,
        );
        expect(cents(balances)).toEqual(cents(payload!.portfolioByTaxType));
        expect(cents(accountBalance)).toEqual(
          cents(payload!.portfolioByAccount),
        );
      } finally {
        await cleanup();
      }
    },
    60_000,
  );
});
