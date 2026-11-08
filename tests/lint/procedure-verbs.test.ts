/**
 * tRPC query names start with a verb that says what they answer
 * (CONTRIBUTING § tRPC verb prefixes): `get` one stored item or current
 * state, `list` a collection, `compute` a derived figure. A bare `get` or
 * `list` under a nested router counts. The router is read as it is mounted,
 * by the reader that writes docs/API_ROUTERS.md. Today's off-prefix queries
 * are OFF_PREFIX_KNOWN, a list that only shrinks (check:ratchets holds it).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRouterCatalog } from "../../scripts/gen-api-docs";

const ROUTERS = path.resolve(__dirname, "../../src/server/routers");
const VERB = /^(?:get|list|compute)(?:[A-Z]|$)/;

/** Queries named before the rule; each is renamed with its callers. */
const OFF_PREFIX_KNOWN = [
  "budget.mortgageItemChoices",
  "contribution.highIncomeLine",
  "contributionProfile.compareData",
  "debts.summary",
  "investments.suggestBasis",
  "investments.suggestPerformance",
  "investments.suggestSnapshot",
  "milestones.firstReached",
  "projection.analyzeStrategy",
  "projection.compareWithdrawalStrategies",
  "projection.peekMonteCarloSummary",
  "projection.projectTaxYears",
  "projection.rothConversionWhatIf",
  "projection.sweepSocialSecurityClaimingAges",
  "settings.firstRunState",
  "settings.isOnboardingComplete",
  "settings.taxData.sectionSources",
  "settings.taxData.status",
  "settings.taxDataSync.preview",
  "settings.taxDataSync.status",
  "settings.testOidcConnection",
  "utilities.previewBudgetApiFeed",
  "version.importDataLoss",
  "version.restoreDataLoss",
];

/** A query path whose last part doesn't start with a read verb. */
const offPrefix = (queryPath: string) =>
  !VERB.test(queryPath.split(".").at(-1) ?? "");

describe("query verb prefixes", () => {
  const queries = readRouterCatalog(ROUTERS)
    .filter((p) => p.kind === "query")
    .map((p) => p.path);

  it("reads the mounted router", () => {
    expect(queries.length).toBeGreaterThan(100);
  });

  it("names every query get, list or compute, but the known ones", () => {
    const known = new Set(OFF_PREFIX_KNOWN);
    expect(queries.filter((q) => offPrefix(q) && !known.has(q))).toEqual([]);
  });

  it("drops a known name once it is renamed or gone", () => {
    const now = new Set(queries.filter(offPrefix));
    expect(OFF_PREFIX_KNOWN.filter((q) => !now.has(q))).toEqual([]);
  });

  it("counts an off-prefix name, a bare verb under a nested router passes", () => {
    expect(
      [
        "a.summary",
        "a.b.list",
        "a.b.get",
        "a.getX",
        "a.listY",
        "a.computeZ",
        "a.getaway",
        "a.lister",
      ].filter(offPrefix),
    ).toEqual(["a.summary", "a.getaway", "a.lister"]);
  });
});
