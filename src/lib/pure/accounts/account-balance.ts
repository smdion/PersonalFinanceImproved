// Accessors/mutators for the AccountBalance discriminated union. All balance
// reads and writes go through these helpers so the rest of the codebase never
// pattern-matches on `structure` directly.

import { assertNever } from "@/lib/utils/assert-never";
import type { AccountBalance } from "@/lib/config/account-types.types";

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getTraditionalBalance(balance: AccountBalance): number {
  return balance.structure === "roth_traditional" ? balance.traditional : 0;
}

export function getRothBalance(balance: AccountBalance): number {
  return balance.structure === "roth_traditional" ? balance.roth : 0;
}

export function getTotalBalance(balance: AccountBalance): number {
  switch (balance.structure) {
    case "roth_traditional":
      return balance.traditional + balance.roth;
    case "single_bucket":
      return balance.balance;
    case "basis_tracking":
      return balance.balance;
    default:
      return assertNever(balance);
  }
}

export function getBasis(balance: AccountBalance): number {
  return balance.structure === "basis_tracking" ? balance.basis : 0;
}

// ---------------------------------------------------------------------------
// Mutators (in-place updates for engine)
// ---------------------------------------------------------------------------

/** Add to the traditional sub-balance (roth_traditional only, no-op for others). */
export function addTraditional(balance: AccountBalance, amount: number): void {
  if (balance.structure === "roth_traditional") balance.traditional += amount;
}

/** Add to the roth sub-balance (roth_traditional only, no-op for others). */
export function addRoth(balance: AccountBalance, amount: number): void {
  if (balance.structure === "roth_traditional") balance.roth += amount;
}

/** Add to the single balance (single_bucket and basis_tracking). */
export function addBalance(balance: AccountBalance, amount: number): void {
  if (balance.structure === "single_bucket") balance.balance += amount;
  else if (balance.structure === "basis_tracking") balance.balance += amount;
}

/** Add to basis tracking (basis_tracking only, no-op for others). */
export function addBasis(balance: AccountBalance, amount: number): void {
  if (balance.structure === "basis_tracking") balance.basis += amount;
}

/** Set the traditional sub-balance. */
export function setTraditional(balance: AccountBalance, value: number): void {
  if (balance.structure === "roth_traditional") balance.traditional = value;
}

/** Set the roth sub-balance. */
export function setRoth(balance: AccountBalance, value: number): void {
  if (balance.structure === "roth_traditional") balance.roth = value;
}

/** Set the single balance. */
export function setBalance(balance: AccountBalance, value: number): void {
  if (balance.structure === "single_bucket") balance.balance = value;
  else if (balance.structure === "basis_tracking") balance.balance = value;
}

/** Set the basis. */
export function setBasis(balance: AccountBalance, value: number): void {
  if (balance.structure === "basis_tracking") balance.basis = value;
}

// ---------------------------------------------------------------------------
// Clone
// ---------------------------------------------------------------------------

/** Deep-clone an AccountBalance. */
export function cloneBalance(balance: AccountBalance): AccountBalance {
  switch (balance.structure) {
    case "roth_traditional":
      return {
        structure: "roth_traditional",
        traditional: balance.traditional,
        roth: balance.roth,
      };
    case "single_bucket":
      return { structure: "single_bucket", balance: balance.balance };
    case "basis_tracking":
      return {
        structure: "basis_tracking",
        balance: balance.balance,
        basis: balance.basis,
      };
    default:
      return assertNever(balance);
  }
}

// ---------------------------------------------------------------------------
// Segment balance reader
// ---------------------------------------------------------------------------

/** Read the balance for a specific account segment from an AccountBalances record. */
export function getSegmentBalance<C extends string>(
  balances: Record<C, AccountBalance>,
  segment: { category: C; subKey: string | null },
): number {
  const balance = balances[segment.category];
  if (segment.subKey === "trad") return getTraditionalBalance(balance);
  if (segment.subKey === "roth") return getRothBalance(balance);
  return getTotalBalance(balance);
}
