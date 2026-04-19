/**
 * Unit tests for projection-year-handler helpers:
 *   - applyLumpSums (lump-sum.ts lines 32-67)
 *   - updatePerPersonTradBalance (helpers.ts lines 20-25)
 *
 * These are pure functions that only touch specific fields of ProjectionContext
 * and ProjectionLoopState, so minimal stubs are sufficient.
 */
import { describe, it, expect } from "vitest";
import { applyLumpSums } from "@/lib/calculators/engine/projection-year-handlers/lump-sum";
import { updatePerPersonTradBalance } from "@/lib/calculators/engine/projection-year-handlers/helpers";
import type {
  ProjectionContext,
  ProjectionLoopState,
} from "@/lib/calculators/engine/projection-year-handlers/types";
import type { LumpSum } from "@/lib/calculators/types";

// ---------------------------------------------------------------------------
// Minimal stubs (only fields the functions actually read)
// ---------------------------------------------------------------------------

function makeCtx(
  overrides: Partial<{
    hasIndividualAccounts: boolean;
    indAccts: { name?: string; category: string; taxType: string }[];
    indKey: (ia: object) => string;
    rmdStartAgeByPerson: Map<number, { startAge: number; birthYear: number }>;
  }> = {},
): ProjectionContext {
  return {
    hasIndividualAccounts: false,
    indAccts: [],
    indKey: (ia: { category: string }) => ia.category,
    rmdStartAgeByPerson: new Map(),
    ...overrides,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionContext;
}

function makeState(
  overrides: Partial<{
    indBal: Map<string, number>;
    priorYearEndTradByPerson: Map<number, number>;
  }> = {},
): ProjectionLoopState {
  return {
    balances: { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0, afterTaxBasis: 0 },
    acctBal: {
      "401k": { structure: "roth_traditional", traditional: 0, roth: 0 },
      "403b": { structure: "roth_traditional", traditional: 0, roth: 0 },
      ira: { structure: "roth_traditional", traditional: 0, roth: 0 },
      hsa: { structure: "single_bucket", balance: 0 },
      brokerage: { structure: "basis_tracking", balance: 0, basis: 0 },
    },
    indBal: new Map<string, number>(),
    priorYearEndTradByPerson: new Map<number, number>(),
    ...overrides,
    // eslint-disable-next-line no-restricted-syntax -- test-only stub for complex engine types
  } as unknown as ProjectionLoopState;
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
    applyLumpSums(ls, makeCtx(), state);
    expect(state.balances.preTax).toBe(50000);
    expect((state.acctBal["401k"] as { traditional: number }).traditional).toBe(
      50000,
    );
  });

  it("adds Roth 401k lump sum to taxFree bucket", () => {
    const state = makeState();
    const ls: LumpSum[] = [
      { amount: 30000, targetAccount: "401k", taxType: "roth" },
    ];
    applyLumpSums(ls, makeCtx(), state);
    expect(state.balances.taxFree).toBe(30000);
    expect((state.acctBal["401k"] as { roth: number }).roth).toBe(30000);
  });

  it("adds HSA lump sum to hsa bucket (single_bucket)", () => {
    const state = makeState();
    const ls: LumpSum[] = [{ amount: 5000, targetAccount: "hsa" }];
    applyLumpSums(ls, makeCtx(), state);
    expect(state.balances.hsa).toBe(5000);
    expect((state.acctBal["hsa"] as { balance: number }).balance).toBe(5000);
  });

  it("adds brokerage lump sum to afterTax bucket with basis (basis_tracking)", () => {
    const state = makeState();
    const ls: LumpSum[] = [{ amount: 20000, targetAccount: "brokerage" }];
    applyLumpSums(ls, makeCtx(), state);
    expect(state.balances.afterTax).toBe(20000);
    expect(state.balances.afterTaxBasis).toBe(20000);
    const brok = state.acctBal["brokerage"] as {
      balance: number;
      basis: number;
    };
    expect(brok.balance).toBe(20000);
    expect(brok.basis).toBe(20000);
  });

  it("updates indBal when hasIndividualAccounts and targetAccountName matches", () => {
    const indBal = new Map<string, number>([["myBrokerage", 100000]]);
    const indAccts = [
      { name: "myBrokerage", category: "brokerage", taxType: "afterTax" },
    ];
    const ctx = makeCtx({
      hasIndividualAccounts: true,
      indAccts,
      indKey: (ia: { name?: string }) => ia.name ?? "",
    });
    const state = makeState({ indBal });
    const ls: LumpSum[] = [
      {
        amount: 15000,
        targetAccount: "brokerage",
        targetAccountName: "myBrokerage",
      },
    ];
    applyLumpSums(ls, ctx, state);
    expect(indBal.get("myBrokerage")).toBe(115000);
  });

  it("updates indBal by category+taxType match when no targetAccountName", () => {
    const indBal = new Map<string, number>([["401k", 200000]]);
    const indAccts = [{ category: "401k", taxType: "preTax" }];
    const ctx = makeCtx({
      hasIndividualAccounts: true,
      indAccts,
      indKey: (ia: { category: string }) => ia.category,
    });
    const state = makeState({ indBal });
    const ls: LumpSum[] = [{ amount: 10000, targetAccount: "401k" }];
    applyLumpSums(ls, ctx, state);
    expect(indBal.get("401k")).toBe(210000);
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

  it("does nothing when hasIndividualAccounts is false", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      hasIndividualAccounts: false,
    });
    const state = makeState();
    state.priorYearEndTradByPerson.set(1, 500);
    updatePerPersonTradBalance(ctx, state);
    expect(state.priorYearEndTradByPerson.get(1)).toBe(500);
  });

  it("accumulates preTax indBal into priorYearEndTradByPerson", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const indAccts = [
      { ownerPersonId: 1, taxType: "preTax", category: "401k" },
      { ownerPersonId: 1, taxType: "preTax", category: "ira" },
    ];
    const indBal = new Map([
      ["401k", 150000],
      ["ira", 50000],
    ]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      hasIndividualAccounts: true,
      indAccts,
      indKey: (ia: { category: string }) => ia.category,
    });
    const state = makeState({ indBal });
    updatePerPersonTradBalance(ctx, state);
    expect(state.priorYearEndTradByPerson.get(1)).toBe(200000);
  });

  it("skips non-preTax accounts in individual account list", () => {
    const rmdMap = new Map([[1, { startAge: 73, birthYear: 1951 }]]);
    const indAccts = [
      { ownerPersonId: 1, taxType: "taxFree", category: "401k" },
    ];
    const indBal = new Map([["401k", 80000]]);
    const ctx = makeCtx({
      rmdStartAgeByPerson: rmdMap,
      hasIndividualAccounts: true,
      indAccts,
      indKey: (ia: { category: string }) => ia.category,
    });
    const state = makeState({ indBal });
    updatePerPersonTradBalance(ctx, state);
    // Roth account skipped — no entry set
    expect(state.priorYearEndTradByPerson.get(1)).toBeUndefined();
  });
});
