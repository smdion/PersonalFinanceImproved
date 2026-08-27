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
  | "unsupported" // the connected provider has no API for this operation at
  // all — not an HTTP failure, retrying or re-authing never helps.
  | "conflict" // the provider CAN perform this operation in general, but
  // the target already has state that can't be safely overwritten without
  // clobbering something the household configured directly — e.g. Actual's
  // note-based goal write finding an existing #template of a different
  // shape already there. See ActualClient.updateCategoryGoalTarget/
  // updateCategoryTargetBalance and actual-goal-notes.ts.
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

/**
 * Shared fetch wrapper for budget API clients (YNAB, Actual Budget).
 * Was structurally duplicated between YnabClient.request() and
 * ActualClient.request() (M45, .scratch/docs/review-findings.md) — same
 * timeout/AbortController/retry wiring, so a future fix to either had to
 * be applied twice and could silently drift.
 *
 * - Throws typed BudgetApiError instead of generic Error so call sites
 *   can distinguish auth/rate-limit/server/network/timeout failures.
 * - Wrapped in retryWithBackoff which honors Retry-After on 429 and does
 *   exponential backoff (1s/2s/4s capped at 30s) for retryable errors.
 *   Auth + client errors are NOT retried.
 */
export async function budgetApiRequest<T>(
  url: string,
  headers: Record<string, string>,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<T> {
  return retryWithBackoff(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { ...headers, ...init?.headers },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw classifyResponse(res, body);
      }
      return (await res.json()) as T;
    } catch (e) {
      // classifyThrown preserves BudgetApiError + classifies AbortError
      // / network errors, so the retry logic can decide whether to retry.
      throw classifyThrown(e);
    } finally {
      clearTimeout(timeout);
    }
  });
}
