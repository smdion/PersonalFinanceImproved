/**
 * The household shapes the baseline households don't cover, each seeded
 * through the write procedures on SQLite with every router query called:
 * none may throw. Paths a household doesn't use stay broken unseen
 * otherwise (Social Security tax and COLA were missing for about seven
 * months; finalizeYear failed on SQLite for 209 days).
 *
 * The matrix: Social Security or none, one adult or several. The baseline
 * already has single and married households with Social Security
 * (ws-h1, ws-h3 and others); these add a single person with none, a couple
 * with none, and three adults (a parent living with the couple). Not pins:
 * the figures are the baseline's job, this only says every page's query
 * answers.
 */
// First: the SQLite harness's mocks, then the baseline's.
import "../routers/setup-mocks";
import "./mocks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestCaller } from "../routers/setup";
import { REVIEWED_HOUSEHOLDS } from "./households-reviewed";
import { PROCEDURES, callProcedure, procedureName } from "./procedures";
import { BASELINE_NOW } from "./router-suite";
import { seedHousehold, type Caller, type Household } from "./seed";

function base(key: string): Household {
  const h = REVIEWED_HOUSEHOLDS.find((x) => x.key === key);
  if (!h) throw new Error(`no baseline household ${key}`);
  return structuredClone(h);
}

function withoutSocialSecurity(h: Household, key: string): Household {
  return {
    ...h,
    key,
    retirement: Object.fromEntries(
      Object.entries(h.retirement).map(([p, r]) => [
        p,
        { ...r, ssMonthly: "0" },
      ]),
    ),
  };
}

/** ws-h3 and a parent (no job, own Social Security) in the household. */
function threeAdults(): Household {
  const h = base("ws-h3");
  return {
    ...h,
    key: "matrix-three-adults",
    people: [
      ...h.people,
      {
        key: "C",
        name: "Robin",
        dateOfBirth: "1958-02-11",
        isPrimaryUser: false,
      },
    ],
    retirement: {
      ...h.retirement,
      C: { retirementAge: 65, endAge: 95, ssMonthly: "1400", ssStartAge: 67 },
    },
  };
}

const MATRIX: Household[] = [
  withoutSocialSecurity(base("ws-h1"), "matrix-single-no-ss"),
  withoutSocialSecurity(base("ws-h3"), "matrix-couple-no-ss"),
  threeAdults(),
];

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

describe.each(MATRIX.map((h) => [h.key, h] as const))(
  "%s",
  (_key, household) => {
    let caller: Caller;
    let close: () => void = () => {};
    let ids: Awaited<ReturnType<typeof seedHousehold>>;

    beforeAll(async () => {
      const opened = await createTestCaller();
      caller = opened.caller;
      close = opened.cleanup;
      ids = await seedHousehold(caller, household);
    }, 60_000);

    afterAll(() => close());

    it("every router query answers", async () => {
      const threw: string[] = [];
      for (const procedure of PROCEDURES) {
        const input = procedure.input?.({ household, ids });
        if (input === null) continue;
        try {
          await callProcedure(caller, procedure, input);
        } catch (error) {
          threw.push(`${procedureName(procedure)}: ${String(error)}`);
        }
      }
      expect(threw).toEqual([]);
    }, 120_000);
  },
);
