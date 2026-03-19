// ---------------------------------------------------------------------------
// Balance discriminated union accessor/mutator functions
// ---------------------------------------------------------------------------
// Works with the AccountBalance discriminated union. All balance reads and
// writes go through these helpers so the rest of the codebase never
// pattern-matches on `structure` directly.

import type {
  AccountBalance,
  AccountCategory,
  BalanceStructure,
} from "./account-types.types";

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getTraditionalBalance(bal: AccountBalance): number {
  return bal.structure === "roth_traditional" ? bal.traditional : 0;
}

export function getRothBalance(bal: AccountBalance): number {
  return bal.structure === "roth_traditional" ? bal.roth : 0;
}

export function getTotalBalance(bal: AccountBalance): number {
  switch (bal.structure) {
    case "roth_traditional":
      return bal.traditional + bal.roth;
    case "single_bucket":
      return bal.balance;
    case "basis_tracking":
      return bal.balance;
  }
}

export function getBasis(bal: AccountBalance): number {
  return bal.structure === "basis_tracking" ? bal.basis : 0;
}

// ---------------------------------------------------------------------------
// Mutators (in-place updates for engine)
// ---------------------------------------------------------------------------

/** Add to the traditional sub-balance (roth_traditional only, no-op for others). */
export function addTraditional(bal: AccountBalance, amount: number): void {
  if (bal.structure === "roth_traditional") bal.traditional += amount;
}

/** Add to the roth sub-balance (roth_traditional only, no-op for others). */
export function addRoth(bal: AccountBalance, amount: number): void {
  if (bal.structure === "roth_traditional") bal.roth += amount;
}

/** Add to the single balance (single_bucket and basis_tracking). */
export function addBalance(bal: AccountBalance, amount: number): void {
  if (bal.structure === "single_bucket") bal.balance += amount;
  else if (bal.structure === "basis_tracking") bal.balance += amount;
}

/** Add to basis tracking (basis_tracking only, no-op for others). */
export function addBasis(bal: AccountBalance, amount: number): void {
  if (bal.structure === "basis_tracking") bal.basis += amount;
}

/** Set the traditional sub-balance. */
export function setTraditional(bal: AccountBalance, value: number): void {
  if (bal.structure === "roth_traditional") bal.traditional = value;
}

/** Set the roth sub-balance. */
export function setRoth(bal: AccountBalance, value: number): void {
  if (bal.structure === "roth_traditional") bal.roth = value;
}

/** Set the single balance. */
export function setBalance(bal: AccountBalance, value: number): void {
  if (bal.structure === "single_bucket") bal.balance = value;
  else if (bal.structure === "basis_tracking") bal.balance = value;
}

/** Set the basis. */
export function setBasis(bal: AccountBalance, value: number): void {
  if (bal.structure === "basis_tracking") bal.basis = value;
}

// ---------------------------------------------------------------------------
// Factory / clone
// ---------------------------------------------------------------------------

/** Create a zero-initialized AccountBalance for the given balance structure. */
export function zeroBalanceForStructure(
  structure: BalanceStructure,
): AccountBalance {
  switch (structure) {
    case "roth_traditional":
      return { structure: "roth_traditional", traditional: 0, roth: 0 };
    case "single_bucket":
      return { structure: "single_bucket", balance: 0 };
    case "basis_tracking":
      return { structure: "basis_tracking", balance: 0, basis: 0 };
  }
}

/** Deep-clone an AccountBalance. */
export function cloneBalance(bal: AccountBalance): AccountBalance {
  switch (bal.structure) {
    case "roth_traditional":
      return {
        structure: "roth_traditional",
        traditional: bal.traditional,
        roth: bal.roth,
      };
    case "single_bucket":
      return { structure: "single_bucket", balance: bal.balance };
    case "basis_tracking":
      return {
        structure: "basis_tracking",
        balance: bal.balance,
        basis: bal.basis,
      };
  }
}

// ---------------------------------------------------------------------------
// Segment balance reader
// ---------------------------------------------------------------------------

/** Read the balance for a specific account segment from an AccountBalances record. */
export function getSegmentBalance(
  balances: Record<AccountCategory, AccountBalance>,
  segment: { category: AccountCategory; subKey: string | null },
): number {
  const bal = balances[segment.category];
  if (segment.subKey === "trad") return getTraditionalBalance(bal);
  if (segment.subKey === "roth") return getRothBalance(bal);
  return getTotalBalance(bal);
}
