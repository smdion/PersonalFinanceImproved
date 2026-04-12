/**
 * Typed errors for budget API integrations (v0.5 expert-review M19/M22).
 *
 * The audit's concern: ynab-client and actual-client both threw generic
 * Error on 401, 403, 429, 500, etc. Sync code couldn't distinguish auth
 * errors (re-auth needed) from rate limits (back off + retry) from server
 * errors (might be transient). This module gives every error a typed
 * subclass so the sync layer + UI can react appropriately.
 */

export type BudgetApiErrorCode =
  | "auth" // 401, 403 — token revoked or wrong scope
  | "rate-limit" // 429 — back off and retry
  | "client" // other 4xx — bad request, malformed payload, etc.
  | "server" // 5xx — transient or upstream broken
  | "network" // fetch threw — DNS / TLS / connectivity
  | "timeout" // AbortController fired
  | "unknown";

export class BudgetApiError extends Error {
  readonly code: BudgetApiErrorCode;
  readonly status: number | null;
  /** Retry-After header value in seconds, if present (rate-limit only). */
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    code: BudgetApiErrorCode,
    status: number | null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "BudgetApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True if the error is worth retrying. */
  get isRetryable(): boolean {
    return (
      this.code === "rate-limit" ||
      this.code === "server" ||
      this.code === "network" ||
      this.code === "timeout"
    );
  }
}

/**
 * Classify a fetch Response into a BudgetApiError. Returns null if the
 * response is OK and the caller should proceed.
 *
 * Reads Retry-After in seconds when status is 429. Falls back to a default
 * backoff if the header is missing or unparseable.
 */
export function classifyResponse(
  res: Response,
  bodyText: string,
): BudgetApiError {
  const status = res.status;
  const truncated = bodyText.slice(0, 500);

  if (status === 401 || status === 403) {
    return new BudgetApiError(
      `Authentication failed (${status}): ${truncated}`,
      "auth",
      status,
    );
  }
  if (status === 429) {
    const ra = res.headers.get("retry-after");
    let retryAfterSeconds: number | null = null;
    if (ra) {
      const asNum = Number(ra);
      if (Number.isFinite(asNum) && asNum > 0) {
        retryAfterSeconds = asNum;
      } else {
        // HTTP-date format — compute delta
        const dateMs = Date.parse(ra);
        if (!isNaN(dateMs)) {
          retryAfterSeconds = Math.max(
            1,
            Math.round((dateMs - Date.now()) / 1000),
          );
        }
      }
    }
    return new BudgetApiError(
      `Rate limited (429)`,
      "rate-limit",
      status,
      retryAfterSeconds,
    );
  }
  if (status >= 500) {
    return new BudgetApiError(
      `Upstream server error (${status}): ${truncated}`,
      "server",
      status,
    );
  }
  if (status >= 400) {
    return new BudgetApiError(
      `Client error (${status}): ${truncated}`,
      "client",
      status,
    );
  }
  // Shouldn't be called for 2xx, but handle it defensively.
  return new BudgetApiError(
    `Unexpected response (${status})`,
    "unknown",
    status,
  );
}

/**
 * Wrap a thrown error from fetch (network/timeout/unknown).
 */
export function classifyThrown(err: unknown): BudgetApiError {
  if (err instanceof BudgetApiError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "AbortError") {
    return new BudgetApiError(`Request timed out: ${msg}`, "timeout", null);
  }
  if (
    err instanceof TypeError ||
    /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg)
  ) {
    return new BudgetApiError(`Network error: ${msg}`, "network", null);
  }
  return new BudgetApiError(msg, "unknown", null);
}

/**
 * Sleep with exponential backoff. Used by retry helpers.
 * attempt=1 → 1s, attempt=2 → 2s, attempt=3 → 4s, ...capped at maxMs.
 */
export function backoffMs(attempt: number, maxMs: number = 30_000): number {
  return Math.min(maxMs, 1000 * Math.pow(2, attempt - 1));
}

/**
 * Retry a fetch operation with exponential backoff. Honors Retry-After
 * header on 429 responses. Gives up after maxAttempts and re-throws the
 * last error.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const apiErr = classifyThrown(err);
      if (!apiErr.isRetryable || attempt === maxAttempts) {
        throw apiErr;
      }
      const delayMs = apiErr.retryAfterSeconds
        ? apiErr.retryAfterSeconds * 1000
        : backoffMs(attempt);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // Should never reach — TS demands a return path.
  throw lastErr;
}
