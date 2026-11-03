/**
 * The import id a created transaction carries (YNAB `import_id`, Actual
 * `imported_id`): a hash of the transaction and its push's `importKey`, so
 * a push can find what it posted even when the response was lost.
 */

import "server-only";
import { createHash } from "node:crypto";

/** What identifies one transaction within one push. */
interface TransactionFingerprint {
  /** The write's own key (NewBudgetTransaction.importKey). */
  importKey: string;
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

/** SHA-256 over a stable JSON form, base64url (no padding): the same
 *  fingerprint always gives the same key. */
export function transactionIdempotencyKey(fp: TransactionFingerprint): string {
  // Canonicalize: sorted keys, normalized null/undefined.
  const canonical = JSON.stringify({
    accountId: fp.accountId,
    amount: fp.amount,
    date: fp.date,
    importKey: fp.importKey,
    memo: fp.memo ?? null,
    payee: fp.payee ?? null,
  });
  const hash = createHash("sha256").update(canonical, "utf8").digest("base64");
  // base64url: replace + → -, / → _, strip =
  return hash.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
