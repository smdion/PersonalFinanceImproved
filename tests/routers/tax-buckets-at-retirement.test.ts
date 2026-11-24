/**
 * projection.computeTaxBucketsAtRetirement equals what the Tax Buckets page
 * computed in the browser before the view moved to the server:
 * computeTaxBucketProjection over computeBreakdown's entries and
 * computeProjection's result, both read as the page read them (JSON).
 * Every baseline household that reaches a retirement transition, plus the
 * one with no accumulation phase left.
 */
import "./setup-mocks";
import "../baseline/mocks";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { computeTaxBucketProjection } from "@/lib/pure/accounts/tax-buckets/tax-bucket-projection";
import { createTestCaller } from "./setup";
import { seedHousehold, type Caller } from "../baseline/seed";
import { HOUSEHOLDS } from "../baseline/households";
import { BASELINE_NOW } from "../baseline/router-suite";

/** What the browser received: a JSON round trip. */
const asReceived = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The page's own composition before the move (use-tax-buckets-projection.ts). */
async function inBrowser(caller: Caller, selection: unknown) {
  const data = asReceived(await caller.taxBuckets.computeBreakdown());
  const run = asReceived(
    await caller.projection.computeProjection({ selection } as never),
  );
  if (!run.result) return { projection: null, annualInflation: null };
  const perPerson = "perPersonSettings" in run ? run.perPersonSettings : null;
  const birthYears = new Map(data.people.map((p) => [p.id, p.birthYear]));
  const projection = computeTaxBucketProjection({
    nowEntries: data.accounts,
    projectionByYear: run.result.projectionByYear,
    people: data.people,
    ruleOf55OverrideByPersonId: perPerson
      ? new Map(perPerson.map((ps) => [ps.personId, ps.ruleOf55Override]))
      : undefined,
    retirementYearByPersonId: perPerson
      ? new Map(
          perPerson.flatMap((ps) => {
            const by = birthYears.get(ps.personId);
            return by != null
              ? [[ps.personId, by + ps.retirementAge] as const]
              : [];
          }),
        )
      : undefined,
  });
  return {
    projection: asReceived(projection),
    annualInflation: "settings" in run ? run.settings.annualInflation : null,
  };
}

describe("projection.computeTaxBucketsAtRetirement", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: BASELINE_NOW });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled"))),
    );
  });
  afterAll(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(HOUSEHOLDS.map((h) => [h.key, h] as const))(
    "%s: equals the page's former browser composition",
    async (_key, household) => {
      const { caller, cleanup } = await createTestCaller();
      try {
        const ids = await seedHousehold(caller, household);
        const selection = {
          contribution: ids.contributionProfile,
          salary: ids.salaryProfile,
        };
        const served = asReceived(
          await caller.projection.computeTaxBucketsAtRetirement({ selection }),
        );
        expect(served).toEqual(await inBrowser(caller, selection));
      } finally {
        await cleanup();
      }
    },
    120_000,
  );
});
