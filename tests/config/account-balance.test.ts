import { describe, it, expect } from "vitest";
import {
  getTraditionalBalance,
  getRothBalance,
  getTotalBalance,
  getBasis,
  addTraditional,
  addRoth,
  addBalance,
  addBasis,
  setTraditional,
  setRoth,
  setBalance,
  setBasis,
  zeroBalanceForStructure,
  cloneBalance,
  getSegmentBalance,
} from "@/lib/config/account-balance";
import type { AccountBalance } from "@/lib/config/account-types.types";

const makeRothTrad = (
  traditional = 100,
  roth = 200,
): AccountBalance & { structure: "roth_traditional" } => ({
  structure: "roth_traditional",
  traditional,
  roth,
});

const makeSingleBucket = (
  balance = 500,
): AccountBalance & { structure: "single_bucket" } => ({
  structure: "single_bucket",
  balance,
});

const makeBasisTracking = (
  balance = 1000,
  basis = 400,
): AccountBalance & { structure: "basis_tracking" } => ({
  structure: "basis_tracking",
  balance,
  basis,
});

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

describe("accessors", () => {
  it("getTraditionalBalance returns traditional for roth_traditional, 0 otherwise", () => {
    expect(getTraditionalBalance(makeRothTrad(100, 200))).toBe(100);
    expect(getTraditionalBalance(makeSingleBucket())).toBe(0);
    expect(getTraditionalBalance(makeBasisTracking())).toBe(0);
  });

  it("getRothBalance returns roth for roth_traditional, 0 otherwise", () => {
    expect(getRothBalance(makeRothTrad(100, 200))).toBe(200);
    expect(getRothBalance(makeSingleBucket())).toBe(0);
    expect(getRothBalance(makeBasisTracking())).toBe(0);
  });

  it("getTotalBalance works for all structures", () => {
    expect(getTotalBalance(makeRothTrad(100, 200))).toBe(300);
    expect(getTotalBalance(makeSingleBucket(500))).toBe(500);
    expect(getTotalBalance(makeBasisTracking(1000, 400))).toBe(1000);
  });

  it("getBasis returns basis for basis_tracking, 0 otherwise", () => {
    expect(getBasis(makeBasisTracking(1000, 400))).toBe(400);
    expect(getBasis(makeRothTrad())).toBe(0);
    expect(getBasis(makeSingleBucket())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

describe("mutators", () => {
  it("addTraditional modifies roth_traditional only", () => {
    const rt = makeRothTrad(100, 200);
    addTraditional(rt, 50);
    expect(rt.traditional).toBe(150);

    const sb = makeSingleBucket(500);
    addTraditional(sb, 50);
    expect(sb.balance).toBe(500); // unchanged
  });

  it("addRoth modifies roth_traditional only", () => {
    const rt = makeRothTrad(100, 200);
    addRoth(rt, 50);
    expect(rt.roth).toBe(250);

    const bt = makeBasisTracking();
    addRoth(bt, 50);
    expect(bt.balance).toBe(1000); // unchanged
  });

  it("addBalance modifies single_bucket and basis_tracking", () => {
    const sb = makeSingleBucket(500);
    addBalance(sb, 100);
    expect(sb.balance).toBe(600);

    const bt = makeBasisTracking(1000, 400);
    addBalance(bt, 100);
    expect(bt.balance).toBe(1100);

    const rt = makeRothTrad(100, 200);
    addBalance(rt, 100);
    expect(rt.traditional).toBe(100); // unchanged
  });

  it("addBasis modifies basis_tracking only", () => {
    const bt = makeBasisTracking(1000, 400);
    addBasis(bt, 100);
    expect(bt.basis).toBe(500);

    const rt = makeRothTrad();
    addBasis(rt, 100);
    expect(rt.traditional).toBe(100); // unchanged
  });

  it("setTraditional sets roth_traditional only", () => {
    const rt = makeRothTrad(100, 200);
    setTraditional(rt, 999);
    expect(rt.traditional).toBe(999);
  });

  it("setRoth sets roth_traditional only", () => {
    const rt = makeRothTrad(100, 200);
    setRoth(rt, 999);
    expect(rt.roth).toBe(999);
  });

  it("setBalance sets single_bucket and basis_tracking", () => {
    const sb = makeSingleBucket(500);
    setBalance(sb, 999);
    expect(sb.balance).toBe(999);

    const bt = makeBasisTracking(1000, 400);
    setBalance(bt, 999);
    expect(bt.balance).toBe(999);
  });

  it("setBasis sets basis_tracking only", () => {
    const bt = makeBasisTracking(1000, 400);
    setBasis(bt, 999);
    expect(bt.basis).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Factory / clone
// ---------------------------------------------------------------------------

describe("zeroBalanceForStructure", () => {
  it("creates zero roth_traditional", () => {
    const bal = zeroBalanceForStructure("roth_traditional");
    expect(bal).toEqual({
      structure: "roth_traditional",
      traditional: 0,
      roth: 0,
    });
  });

  it("creates zero single_bucket", () => {
    const bal = zeroBalanceForStructure("single_bucket");
    expect(bal).toEqual({ structure: "single_bucket", balance: 0 });
  });

  it("creates zero basis_tracking", () => {
    const bal = zeroBalanceForStructure("basis_tracking");
    expect(bal).toEqual({
      structure: "basis_tracking",
      balance: 0,
      basis: 0,
    });
  });
});

describe("cloneBalance", () => {
  it("produces an independent copy for each structure", () => {
    const rt = makeRothTrad(100, 200);
    const clone = cloneBalance(rt);
    expect(clone).toEqual(rt);
    addTraditional(rt, 50);
    expect(getTraditionalBalance(clone)).toBe(100); // not affected

    const sb = makeSingleBucket(500);
    const sbClone = cloneBalance(sb);
    expect(sbClone).toEqual(sb);

    const bt = makeBasisTracking(1000, 400);
    const btClone = cloneBalance(bt);
    expect(btClone).toEqual(bt);
  });
});

// ---------------------------------------------------------------------------
// Segment balance reader
// ---------------------------------------------------------------------------

describe("getSegmentBalance", () => {
  const balances = {
    retirement: makeRothTrad(100, 200),
    brokerage: makeBasisTracking(1000, 400),
    cash: makeSingleBucket(500),
  } as Record<string, AccountBalance>;

  it("returns traditional sub-balance with trad subKey", () => {
    expect(
      getSegmentBalance(balances as never, {
        category: "retirement" as never,
        subKey: "trad",
      }),
    ).toBe(100);
  });

  it("returns roth sub-balance with roth subKey", () => {
    expect(
      getSegmentBalance(balances as never, {
        category: "retirement" as never,
        subKey: "roth",
      }),
    ).toBe(200);
  });

  it("returns total balance with null subKey", () => {
    expect(
      getSegmentBalance(balances as never, {
        category: "cash" as never,
        subKey: null,
      }),
    ).toBe(500);
  });
});
