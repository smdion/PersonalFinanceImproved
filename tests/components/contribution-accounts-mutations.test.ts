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
import { renderHook } from "@testing-library/react";

const makeMutation = () => ({
  mutate: vi.fn(),
  isPending: false,
  isSuccess: false,
  isError: false,
  data: null,
  error: null,
  reset: vi.fn(),
});

const invalidateFns = {
  performanceAccounts: vi.fn(),
  contributionAccounts: vi.fn(),
  portfolioSnapshotsGetLatest: vi.fn(),
  retirement: vi.fn(),
  projection: vi.fn(),
  networth: vi.fn(),
};

const stableUtils = {
  settings: {
    performanceAccounts: { invalidate: invalidateFns.performanceAccounts },
    contributionAccounts: { invalidate: invalidateFns.contributionAccounts },
    portfolioSnapshots: {
      getLatest: { invalidate: invalidateFns.portfolioSnapshotsGetLatest },
    },
  },
  retirement: { invalidate: invalidateFns.retirement },
  projection: { invalidate: invalidateFns.projection },
  networth: { invalidate: invalidateFns.networth },
};

// Capture the mutate fn + onSuccess callback for each mutation so tests can
// both assert on the input shape passed to mutate() and (optionally) fire
// onSuccess to verify the invalidate wiring.
const mutations: Record<string, ReturnType<typeof makeMutation>> = {};
const onSuccessCallbacks: Record<string, (() => void) | undefined> = {};

function mutationFactory(key: string) {
  return {
    useMutation: (opts?: { onSuccess?: () => void }) => {
      const m = makeMutation();
      mutations[key] = m;
      onSuccessCallbacks[key] = opts?.onSuccess;
      return m;
    },
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => stableUtils,
    settings: {
      performanceAccounts: {
        update: mutationFactory("updatePerf"),
        create: mutationFactory("createPerf"),
        delete: mutationFactory("deletePerf"),
      },
      contributionAccounts: {
        update: mutationFactory("updateContrib"),
        create: mutationFactory("createContrib"),
      },
      portfolioSnapshots: {
        updateAccount: mutationFactory("updatePortfolioAccount"),
        createAccount: mutationFactory("createPortfolioAccount"),
      },
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const basePerfAccount = {
  id: 1,
  institution: "Fidelity",
  accountType: "401k",
  subType: null,
  label: null,
  displayName: null,
  ownerPersonId: 5,
  ownershipType: "individual",
  parentCategory: "Retirement",
  isActive: true,
  displayOrder: 0,
  retirementBehavior: "stops_at_owner_retirement",
  contributionScaling: "scales_with_salary",
};

const baseContrib = {
  id: 1,
  personId: 5,
  jobId: 10,
  accountType: "401k",
  taxTreatment: "pre_tax",
  contributionMethod: "percent_of_salary",
  contributionValue: "10",
  employerMatchType: "none",
  employerMatchValue: null,
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
    await import("@/components/portfolio/use-contribution-accounts-mutations");
  return mod.useContributionAccountsMutations;
}

describe("useContributionAccountsMutations", () => {
  it("returns the expected mutation/helper shape", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    expect(result.current).toHaveProperty("createPerfMut");
    expect(result.current).toHaveProperty("deletePerfMut");
    expect(result.current).toHaveProperty("createContribMut");
    expect(result.current).toHaveProperty("updatePortfolioAccountMut");
    expect(result.current).toHaveProperty("createPortfolioAccountMut");
    expect(typeof result.current.handlePerfUpdate).toBe("function");
    expect(typeof result.current.handleContribUpdate).toBe("function");
    expect(typeof result.current.handleLinkContrib).toBe("function");
  });

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
    expect(mutations.updatePerf.mutate).toHaveBeenCalledWith(
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
    expect(mutations.updatePerf.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ subType: null, label: null }),
    );
  });

  it("handlePerfUpdate allows ownerPersonId to be explicitly set to null (unassigning owner)", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.handlePerfUpdate(basePerfAccount, { ownerPersonId: null });
    expect(mutations.updatePerf.mutate).toHaveBeenCalledWith(
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
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, personId: null }),
    );
    // Specifically assert it did NOT fall back to the stale personId — this
    // is exactly the bug the !== undefined fix closed.
    const call = mutations.updateContrib.mutate.mock.calls[0]![0];
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
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
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
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
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
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ employerMatchValue: null }),
    );
  });

  // ---------------------------------------------------------------------
  // handleLinkContrib
  // ---------------------------------------------------------------------

  it("handleLinkContrib finds the contrib by id and updates its performanceAccountId", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContrib(1, 99);
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, performanceAccountId: 99 }),
    );
  });

  it("handleLinkContrib allows unlinking via performanceAccountId: null", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContrib(1, null);
    expect(mutations.updateContrib.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, performanceAccountId: null }),
    );
  });

  it("handleLinkContrib is a no-op when the contrib id is not found", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [baseContrib] }),
    );
    result.current.handleLinkContrib(999, 99);
    expect(mutations.updateContrib.mutate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Mutation input shapes for create/delete
  // ---------------------------------------------------------------------

  it("createPerfMut.mutate fires with a create-shaped payload", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.createPerfMut.mutate({
      institution: "Schwab",
      accountType: "brokerage",
      ownershipType: "individual",
      parentCategory: "Portfolio",
    });
    expect(mutations.createPerf.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ institution: "Schwab" }),
    );
  });

  it("deletePerfMut.mutate fires with the account id", async () => {
    const useContributionAccountsMutations = await importHook();
    const { result } = renderHook(() =>
      useContributionAccountsMutations({ allContribs: [] }),
    );
    result.current.deletePerfMut.mutate({ id: 42 });
    expect(mutations.deletePerf.mutate).toHaveBeenCalledWith({ id: 42 });
  });

  // ---------------------------------------------------------------------
  // onSuccess wiring
  // ---------------------------------------------------------------------

  it("createPerfMut's onSuccess invalidates performanceAccounts and calls onCreatePerfSuccess", async () => {
    const useContributionAccountsMutations = await importHook();
    const onCreatePerfSuccess = vi.fn();
    renderHook(() =>
      useContributionAccountsMutations({
        allContribs: [],
        onCreatePerfSuccess,
      }),
    );
    onSuccessCallbacks.createPerf?.();
    expect(invalidateFns.performanceAccounts).toHaveBeenCalled();
    expect(onCreatePerfSuccess).toHaveBeenCalled();
  });

  it("updatePerfMut's onSuccess invalidates performanceAccounts, retirement, projection, and networth", async () => {
    const useContributionAccountsMutations = await importHook();
    renderHook(() => useContributionAccountsMutations({ allContribs: [] }));
    onSuccessCallbacks.updatePerf?.();
    expect(invalidateFns.performanceAccounts).toHaveBeenCalled();
    expect(invalidateFns.retirement).toHaveBeenCalled();
    expect(invalidateFns.projection).toHaveBeenCalled();
    expect(invalidateFns.networth).toHaveBeenCalled();
  });

  it("updateContribMut's onSuccess invalidates contributionAccounts, retirement, and projection", async () => {
    const useContributionAccountsMutations = await importHook();
    renderHook(() => useContributionAccountsMutations({ allContribs: [] }));
    onSuccessCallbacks.updateContrib?.();
    expect(invalidateFns.contributionAccounts).toHaveBeenCalled();
    expect(invalidateFns.retirement).toHaveBeenCalled();
    expect(invalidateFns.projection).toHaveBeenCalled();
  });

  it("updatePortfolioAccountMut's onSuccess invalidates portfolioSnapshots.getLatest and networth", async () => {
    const useContributionAccountsMutations = await importHook();
    renderHook(() => useContributionAccountsMutations({ allContribs: [] }));
    onSuccessCallbacks.updatePortfolioAccount?.();
    expect(invalidateFns.portfolioSnapshotsGetLatest).toHaveBeenCalled();
    expect(invalidateFns.networth).toHaveBeenCalled();
  });
});
