/**
 * Unit tests for projection-year-handler helpers:
 *   - applyLumpSums (lump-sum.ts), its lump sums resolved as `resolveLumpSums` does
 *   - updatePerPersonTradBalance (helpers.ts lines 20-25)
 *
 * These are pure functions that only touch specific fields of ProjectionContext
 * and ProjectionLoopState, so minimal stubs are sufficient.
 */
import { describe, it, expect } from "vitest";
import { applyLumpSums } from "@/lib/pure/engine/projection-year-handlers/lump-sum";
import { updatePerPersonTradBalance } from "@/lib/pure/engine/projection-year-handlers/helpers";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/pure/engine/projection-year-handlers/types";
import type { LumpSum } from "@/lib/pure/engine/types";
import { lumpSumTargetOf } from "@/lib/pure/engine/lump-sum-targets";
import type { LumpSumTargets } from "@/lib/pure/engine/lump-sum-targets";
import { makeIndKey } from "@/lib/pure/engine/individual-accounts/ledger";
import type { IndividualAccountInput } from "@/lib/pure/accounts/account-balances.types";
import type { AccountCategory } from "@/lib/config/account-types";

// ---------------------------------------------------------------------------
// Minimal stubs (only fields the functions actually read)
// ---------------------------------------------------------------------------

function makeCtx(
  overrides: Partial<{
    holdsAccounts: boolean;
    indAccounts: {
      name?: string;
      category: string;
      taxType: string;
      ownerPersonId?: number;
    }[];
    indKey: (ia: IndividualAccountInput) => string;
    lumpSumTargets: LumpSumTargets;
    rmdStartAgeByPerson: Map<number, { startAge: number; birthYear: number }>;
  }> = {},
): ProjectionContext {
  return {
    holdsAccounts: false,
    indAccounts: [],
    // Keyed by category alone — this test\'s indBalance is keyed the same way.
    indKey: (ia: object) => (ia as { category: string }).category,
    rmdStartAgeByPerson: new Map(),
    lumpSumTargets: new Map(),
    ...overrides,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionContext;
}

function makeState(
  overrides: Partial<{
    indBalance: Map<string, number>;
    priorYearEndTradByPerson: Map<number, number>;
  }> = {},
): ProjectionLoopState {
  return {
    balances: { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0, afterTaxBasis: 0 },
    accountBalance: {
      "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    },
    indBalance: new Map<string, number>(),
    priorYearEndTradByPerson: new Map<number, number>(),
    ...overrides,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionLoopState;
}

/** Each lump sum's target over `parts`, as `resolveLumpSums` resolves them
 *  for the run's context. */
const targetsOf = (ls: LumpSum[], parts: readonly IndividualAccountInput[]) =>
  new Map(ls.map((l) => [l, lumpSumTargetOf(l, parts)]));

const indKey = makeIndKey();

/** A held part with its own performance account. */
const part = (
  name: string,
  category: AccountCategory,
  taxType: string,
  performanceAccountId: number,
  extra: Partial<IndividualAccountInput> = {},
): IndividualAccountInput => ({
  name,
  category,
  taxType,
  performanceAccountId,
  startingBalance: 0,
  ...extra,
});

/** A run holding `indAccounts`, with `ls` resolved over them. */
function apply(
  ls: LumpSum[],
  indAccounts: IndividualAccountInput[],
  state: ProjectionLoopState,
) {
  const ctx = makeCtx({
    holdsAccounts: indAccounts.length > 0,
    indAccounts,
    indKey,
    lumpSumTargets: targetsOf(ls, indAccounts),
  });
  applyLumpSums(ls, ctx, state);
}

// ---------------------------------------------------------------------------
// applyLumpSums
// ---------------------------------------------------------------------------

describe("applyLumpSums", () => {
  it("adds traditional 401k lump sum to preTax bucket", () => {
    const state = makeState();
    const ls: LumpSum[] = [
      { amount: 50000, targetAccount: "401k", taxType: "traditional" },
    ];
    apply(ls, [], state);
    expect(state.balances.preTax).toBe(50000);
    expect(
      (state.accountBalance["401k"] as { traditional: number }).traditional,
    ).toBe(50000);
  });

  it("adds Roth 401k lump sum to taxFree bucket", () => {
    const state = makeState();
    const ls: LumpSum[] = [
      { amount: 30000, targetAccount: "401k", taxType: "roth" },
    ];
    apply(ls, [], state);
    expect(state.balances.taxFree).toBe(30000);
    expect((state.accountBalance["401k"] as { roth: number }).roth).toBe(30000);
  });

  it("adds HSA lump sum to hsa bucket (single_bucket)", () => {
    const state = makeState();
    const ls: LumpSum[] = [{ amount: 5000, targetAccount: "hsa" }];
    apply(ls, [], state);
    expect(state.balances.hsa).toBe(5000);
    expect((state.accountBalance["hsa"] as { balance: number }).balance).toBe(
      5000,
    );
  });

  it("adds brokerage lump sum to afterTax bucket with basis (basis_tracking)", () => {
    const state = makeState();
    const ls: LumpSum[] = [{ amount: 20000, targetAccount: "brokerage" }];
    apply(ls, [], state);
    expect(state.balances.afterTax).toBe(20000);
    expect(state.balances.afterTaxBasis).toBe(20000);
    const brok = state.accountBalance["brokerage"] as {
      balance: number;
      basis: number;
    };
    expect(brok.balance).toBe(20000);
    expect(brok.basis).toBe(20000);
  });

  it("updates indBal when some part is held and its target is that part", () => {
    const indAccounts = [part("myBrokerage", "brokerage", "afterTax", 1)];
    const indBalance = new Map([[indKey(indAccounts[0]!), 100000]]);
    const state = makeState({ indBalance });
    apply(
      [
        {
          amount: 15000,
          targetAccount: "brokerage",
          targetAccountName: "myBrokerage",
        },
      ],
      indAccounts,
      state,
    );
    expect(indBalance.get(indKey(indAccounts[0]!))).toBe(115000);
  });

  it("R4: a name two owners share resolves to the named owner's part — the lump sum lands on the RIGHT owner's account", () => {
    const alex = part("Long Term Brokerage", "brokerage", "afterTax", 1, {
      ownerName: "Alex",
      ownerPersonId: 1,
    });
    const sam = part("Long Term Brokerage", "brokerage", "afterTax", 2, {
      ownerName: "Sam",
      ownerPersonId: 2,
    });
    const indBalance = new Map([
      [indKey(alex), 200000],
      [indKey(sam), 150000],
    ]);
    const state = makeState({ indBalance });
    apply(
      [
        {
          amount: 10000,
          targetAccount: "brokerage",
          targetAccountName: "Long Term Brokerage",
          targetOwnerName: "Sam",
        },
      ],
      [alex, sam],
      state,
    );
    expect(indBalance.get(indKey(sam))).toBe(160000);
    // Alex's identically-named account must be untouched.
    expect(indBalance.get(indKey(alex))).toBe(200000);
  });

  it("R4: a name with no owner name resolves by name alone (lump sums saved before the field existed)", () => {
    const indAccounts = [part("myBrokerage", "brokerage", "afterTax", 1)];
    const indBalance = new Map([[indKey(indAccounts[0]!), 100000]]);
    const state = makeState({ indBalance });
    apply(
      [
        {
          amount: 15000,
          targetAccount: "brokerage",
          targetAccountName: "myBrokerage",
          // targetOwnerName deliberately omitted
        },
      ],
      indAccounts,
      state,
    );
    expect(indBalance.get(indKey(indAccounts[0]!))).toBe(115000);
  });

  it("updates indBal by category+taxType match when no account is named", () => {
    const indAccounts = [part("401k", "401k", "preTax", 1)];
    const indBalance = new Map([[indKey(indAccounts[0]!), 200000]]);
    const state = makeState({ indBalance });
    apply([{ amount: 10000, targetAccount: "401k" }], indAccounts, state);
    expect(indBalance.get(indKey(indAccounts[0]!))).toBe(210000);
  });

  it("a lump sum that reached it unresolved throws", () => {
    expect(() =>
      applyLumpSums(
        [{ amount: 10000, targetAccount: "401k" }],
        makeCtx(),
        makeState(),
      ),
    ).toThrow("no target");
  });
});

// ---------------------------------------------------------------------------
// updatePerPersonTradBalance
// ---------------------------------------------------------------------------

describe("updatePerPersonTradBalance", () => {
  it("does nothing when rmdStartAgeByPerson is empty", () => {
    const state = makeState();
    state.priorYearEndTradByPerson.set(1, 999);
    updatePerPersonTradBalance(makeCtx(), state);
    // Should be unchanged — early return triggered
    expect(state.priorYearEndTradByPerson.get(1)).toBe(999);
  });

  it("does nothing when no account part is held", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      holdsAccounts: false,
    });
    const state = makeState();
    state.priorYearEndTradByPerson.set(1, 500);
    updatePerPersonTradBalance(ctx, state);
    expect(state.priorYearEndTradByPerson.get(1)).toBe(500);
  });

  it("accumulates preTax indBal into priorYearEndTradByPerson", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const indAccounts = [
      { ownerPersonId: 1, taxType: "preTax", category: "401k" },
      { ownerPersonId: 1, taxType: "preTax", category: "ira" },
    ];
    const indBalance = new Map([
      ["401k", 150000],
      ["ira", 50000],
    ]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      holdsAccounts: true,
      indAccounts,
      // Keyed by category alone — this test\'s indBalance is keyed the same way.
      indKey: (ia: object) => (ia as { category: string }).category,
    });
    const state = makeState({ indBalance });
    updatePerPersonTradBalance(ctx, state);
    expect(state.priorYearEndTradByPerson.get(1)).toBe(200000);
  });

  it("skips non-preTax accounts in individual account list", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const indAccounts = [
      { ownerPersonId: 1, taxType: "taxFree", category: "401k" },
    ];
    const indBalance = new Map([["401k", 80000]]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      holdsAccounts: true,
      indAccounts,
      // Keyed by category alone — this test\'s indBalance is keyed the same way.
      indKey: (ia: object) => (ia as { category: string }).category,
    });
    const state = makeState({ indBalance });
    updatePerPersonTradBalance(ctx, state);
    // Roth account skipped — no entry set
    expect(state.priorYearEndTradByPerson.get(1)).toBeUndefined();
  });
});
