/**
 * Tests for useContributionAccountsMutations — the 7 tRPC mutations backing
 * the contribution-accounts card (performance/contribution account
 * create/update/delete, portfolio sub-account create/update) plus the two
 * partial-updater helpers (handlePerfUpdate, handleContribUpdate) and the
 * link-contrib helper.
 *
 * Regression coverage for F4/F5: `handleContribUpdate`'s personId merge used
 * to be `updates.personId ?? c.personId`, which silently discarded an
 * explicit `personId: null` (exactly what the Owner-dropdown "unset owner"
 * flow sends) by falling back to the stale value. It was changed to
 * `updates.personId !== undefined ? updates.personId : c.personId`. The
 * "explicit personId: null is preserved" test below guards against that bug
 * reappearing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RouterOutputs } from "@/lib/trpc";
import { renderHook } from "@testing-library/react";
import {
  holdMutation,
  mutationCalls,
  resetTrpcMock,
  settleMutation,
  utilsCalls,
} from "./trpc-mock";

vi.mock("@/lib/trpc", async () => ({
  trpc: (await import("./trpc-mock")).trpc,
}));

const P = {
  updateContrib: "contribution.accounts.update",
  createContrib: "contribution.accounts.create",
  updatePortfolioAccount: "netWorth.portfolioSnapshots.updateAccount",
  createPortfolioAccount: "netWorth.portfolioSnapshots.createAccount",
  updatePerf: "performance.performanceAccounts.update",
  createPerf: "performance.performanceAccounts.create",
  deletePerf: "performance.performanceAccounts.delete",
  setContribProfileFields: "contributionProfile.setAccountActiveFields",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  resetTrpcMock();
  // Calls are recorded, nothing settles until a test settles it (the
  // onSuccess wiring tests below), as before.
  for (const path of Object.values(P)) holdMutation(path);
});

/** Every utils call a successful mutation should have made. */
const invalidated = (path: string) => utilsCalls(path).length > 0;

type PerfAccount =
  RouterOutputs["performance"]["performanceAccounts"]["list"][number];
type Contrib = RouterOutputs["contribution"]["accounts"]["list"][number];

const basePerfAccount: PerfAccount = {
  id: 1,
  institution: "Fidelity",
  accountType: "401k",
  subType: null,
  label: null,
  accountLabel: "Fidelity 401k",
  displayName: null,
  ownerPersonId: 5,
  ownershipType: "individual",
  parentCategory: "Retirement",
  isActive: true,
  displayOrder: 0,
  retirementBehavior: "stops_at_owner_retirement",
  contributionScaling: "scales_with_salary",
  costBasis: "0",
  separationDate: null,
  allowPenalizedWithdrawals: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const baseContrib: Contrib = {
  id: 1,
  personId: 5,
  jobId: 10,
  accountType: "401k",
  subType: null,
  label: null,
  parentCategory: "Retirement",
  priorYearContribAmount: "0",
  priorYearContribYear: null,
  taxTreatment: "pre_tax",
  employerMatchType: "none",
  employerMatchValue: null,
  employerMatchRate: null,
  employerMaxMatchPct: null,
  employerMatchTaxTreatment: "pre_tax",
  hsaCoverageType: null,
  autoMaximize: false,
  isActive: true,
  ownership: "individual",
  performanceAccountId: 1,
  targetAnnual: null,
  allocationPriority: 0,
  notes: null,
  isPayrollDeducted: null,
};

async function importHook() {
  const mod =
    await import("@/components/contributions/use-contribution-accounts-mutations");
  return mod.useContributionAccountsMutations;
}

describe("useContributionAccountsMutations", () => {
  // ---------------------------------------------------------------------
  // handlePerfUpdate
  // ---------------------------------------------------------------------

  it("handlePerfUpdate merges partial updates over the existing record", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handlePerfUpdate(basePerfAccount, {
      institution: "Vanguard",
    });
    expect(mutationCalls(P.updatePerf)).toContainEqual(
      expect.objectContaining({
        id: 1,
        institution: "Vanguard",
        accountType: "401k",
        ownerPersonId: 5,
        ownershipType: "individual",
        parentCategory: "Retirement",
        isActive: true,
        displayOrder: 0,
        retirementBehavior: "stops_at_owner_retirement",
        contributionScaling: "scales_with_salary",
      }),
    );
  });

  it("handlePerfUpdate preserves an explicit null subType/label instead of falling back", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handlePerfUpdate(
      { ...basePerfAccount, subType: "roth", label: "My Account" },
      { subType: null, label: null },
    );
    expect(mutationCalls(P.updatePerf)).toContainEqual(
      expect.objectContaining({ subType: null, label: null }),
    );
  });

  it("handlePerfUpdate allows ownerPersonId to be explicitly set to null (unassigning owner)", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handlePerfUpdate(basePerfAccount, { ownerPersonId: null });
    expect(mutationCalls(P.updatePerf)).toContainEqual(
      expect.objectContaining({ ownerPersonId: null }),
    );
  });

  // ---------------------------------------------------------------------
  // handleContribUpdate — F4 personId regression coverage
  // ---------------------------------------------------------------------

  it("handleContribUpdate sends an explicit personId: null (regression guard for the F4 ?? bug)", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handleContribUpdate(baseContrib, { personId: null });
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({ id: 1, personId: null }),
    );
    // Specifically assert it did NOT fall back to the stale personId — this
    // is exactly the bug the !== undefined fix closed.
    const call = mutationCalls(P.updateContrib)[0] as { personId: unknown };
    expect(call.personId).not.toBe(baseContrib.personId);
  });

  it("handleContribUpdate falls back to the existing personId when omitted from updates", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handleContribUpdate(baseContrib, {
      autoMaximize: true,
    });
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({
        id: 1,
        personId: 5,
        autoMaximize: true,
      }),
    );
  });

  it("handleContribUpdate merges partial updates over the existing record for other fields", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handleContribUpdate(baseContrib, {
      autoMaximize: true,
      isActive: false,
    });
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({
        id: 1,
        autoMaximize: true,
        isActive: false,
        // Unrelated fields carried over unchanged
        accountType: "401k",
        taxTreatment: "pre_tax",
      }),
    );
  });

  it("handleContribUpdate preserves an explicit employerMatchValue: null instead of falling back", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handleContribUpdate(
      { ...baseContrib, employerMatchValue: "50" },
      { employerMatchValue: null },
    );
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({ employerMatchValue: null }),
    );
  });

  // ---------------------------------------------------------------------
  // handleLinkContribution
  // ---------------------------------------------------------------------

  it("handleContribUpdate saves a Roth IRA route to the active Contribution Profile — direct as absent, never on the account row", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({
        allContribs: [],
        activeContributionProfileId: 9,
      }),
    );
    result.current.handleContribUpdate(baseContrib, { rothRoute: "backdoor" });
    expect(mutationCalls(P.setContribProfileFields).at(-1)).toEqual({
      profileId: 9,
      accountId: 1,
      fields: { rothRoute: "backdoor" },
    });
    result.current.handleContribUpdate(baseContrib, { rothRoute: "direct" });
    expect(mutationCalls(P.setContribProfileFields).at(-1)).toEqual({
      profileId: 9,
      accountId: 1,
      fields: {},
      unset: ["rothRoute"],
    });
    expect(mutationCalls(P.updateContrib)).toHaveLength(0);
  });

  it("handleLinkContrib finds the contrib by id and updates its performanceAccountId", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContribution(1, 99);
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({ id: 1, performanceAccountId: 99 }),
    );
  });

  it("handleLinkContrib allows unlinking via performanceAccountId: null", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContribution(1, null);
    expect(mutationCalls(P.updateContrib)).toContainEqual(
      expect.objectContaining({ id: 1, performanceAccountId: null }),
    );
  });

  it("handleLinkContrib is a no-op when the contrib id is not found", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContribution(999, 99);
    expect(mutationCalls(P.updateContrib)).toHaveLength(0);
  });

  // ---------------------------------------------------------------------
  // onSuccess wiring
  // ---------------------------------------------------------------------

  it("createPerfMut's onSuccess invalidates performanceAccounts", async () => {
    // No parent-UI-state callback here (RULES.md Mutation Hook Convention
    // rule 3) — a caller that wants to react to success (e.g. closing a
    // form) passes its own onSuccess at the .mutate() call site instead.
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    // Any input: the mock records it; this test is about what success does.
    result.current.createPerfMut.mutate(
      basePerfAccount as Parameters<
        typeof result.current.createPerfMut.mutate
      >[0],
    );
    settleMutation(P.createPerf);
    expect(invalidated("performance.performanceAccounts.invalidate")).toBe(
      true,
    );
  });

  it("updatePerfMut's onSuccess invalidates performanceAccounts, retirement, projection, and netWorth", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handlePerfUpdate(basePerfAccount, {});
    settleMutation(P.updatePerf);
    expect(invalidated("performance.performanceAccounts.invalidate")).toBe(
      true,
    );
    expect(invalidated("retirement.invalidate")).toBe(true);
    expect(invalidated("projection.invalidate")).toBe(true);
    expect(invalidated("netWorth.invalidate")).toBe(true);
  });

  it("updateContribMut's onSuccess invalidates contributionAccounts, retirement, and projection", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handleContribUpdate(baseContrib, {});
    settleMutation(P.updateContrib);
    expect(invalidated("contribution.accounts.invalidate")).toBe(true);
    expect(invalidated("retirement.invalidate")).toBe(true);
    expect(invalidated("projection.invalidate")).toBe(true);
  });

  it("updatePortfolioAccountMut's onSuccess invalidates portfolioSnapshots.getLatest and netWorth", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    // Any input: the mock records it; this test is about what success does.
    result.current.updatePortfolioAccountMut.mutate({ id: 1 } as Parameters<
      typeof result.current.updatePortfolioAccountMut.mutate
    >[0]);
    settleMutation(P.updatePortfolioAccount);
    expect(
      invalidated("netWorth.portfolioSnapshots.getLatest.invalidate"),
    ).toBe(true);
    expect(invalidated("netWorth.invalidate")).toBe(true);
  });
});
