/**
 * Idempotency key generation for transaction creation (v0.5 expert-review M20).
 *
 * The audit's concern: a sync that succeeds server-side but loses the
 * response (network glitch, container restart) gets retried, creating a
 * duplicate transaction. Both YNAB and Actual support idempotency keys
 * via header or body field, but the existing clients don't pass one.
 *
 * Strategy: a deterministic per-payload key derived from the user's local
 * fingerprint of the transaction. Same payload → same key → upstream
 * deduplicates on retry. Different payload → different key → upstream
 * accepts as a new transaction. Pure SHA-256 over a stable JSON
 * representation; no randomness.
 */

import { createHash } from "node:crypto";

/**
 * Build an idempotency key for a transaction. The fields used to derive
 * the key are the ones that uniquely identify a single transaction in
 * the user's intent: account, date, amount, payee, memo. Two calls with
 * the same fields produce the same key, so the upstream API can
 * deduplicate.
 */
export interface TransactionFingerprint {
  /** Remote account ID (YNAB account UUID, Actual account name). */
  accountId: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Amount in the smallest unit (cents for Actual, milliunits for YNAB). */
  amount: number;
  /** Payee or category name, if any. */
  payee?: string | null;
  /** Memo / note. */
  memo?: string | null;
}

/**
 * Compute an idempotency key from a transaction fingerprint.
 *
 * Uses SHA-256 over a stable JSON representation. The key is base64url
 * (URL-safe, no padding) so it can ride in either an HTTP header or a
 * JSON body field without escaping.
 *
 * Stable across calls: same input → same output, no time / random.
 */
export function transactionIdempotencyKey(fp: TransactionFingerprint): string {
  // Canonicalize: sorted keys, normalized null/undefined.
  const canonical = JSON.stringify({
    accountId: fp.accountId,
    amount: fp.amount,
    date: fp.date,
    memo: fp.memo ?? null,
    payee: fp.payee ?? null,
  });
  const hash = createHash("sha256").update(canonical, "utf8").digest("base64");
  // base64url: replace + → -, / → _, strip =
  return hash.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
