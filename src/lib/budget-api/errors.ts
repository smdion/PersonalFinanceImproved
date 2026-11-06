/**
 * Typed errors for budget API integrations.
 *
 * The concern: ynab-client and actual-client both threw generic
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
  // shape already there. See BudgetAPIClient.prepareGoalWrite and
  // actual-goal-notes.ts.
  | "bad-response" // the service answered, but not in the shape Ledgr
  // reads (a missing, renamed or mistyped field); the same answer would
  // come back, so it's never retried.
  | "refused-url" // Ledgr refused the address itself (private, local, or
  // a redirect to another host); never retried.
  | "unknown";

export class BudgetApiError extends Error {
  readonly code: BudgetApiErrorCode;
  readonly status: number | null;
  /** Retry-After header value in seconds, if present (rate-limit only). */
  readonly retryAfterSeconds: number | null;
  /** The service's name ("Actual"), and for a bad-response the first field
   *  that didn't fit; set where the request is made. */
  service?: string;
  field?: string;
  /** The start of an error answer's body, for code that reads what the
   *  service said. It can echo the request: set by keepResponseText,
   *  non-enumerable, so no message, JSON or inspect of the error shows it. */
  declare readonly responseText?: string;

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

  keepResponseText(text: string): void {
    Object.defineProperty(this, "responseText", {
      value: text.slice(0, 500),
      enumerable: false,
    });
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

/** What a user is told about a failed request to a service. */
export function externalErrorSentence(e: BudgetApiError): string {
  const who = e.service ?? "The service";
  switch (e.code) {
    case "bad-response":
      return `${who} sent something Ledgr doesn't understand${e.field ? ` (${e.field})` : ""}.`;
    case "auth":
      return `${who} didn't accept Ledgr's credentials — reconnect it in Settings.`;
    case "rate-limit":
      return `${who} asked Ledgr to slow down — try again in a few minutes.`;
    case "network":
    case "timeout":
      return `Ledgr couldn't reach ${who} — try again.`;
    case "client":
      return `${who} refused Ledgr's request.`;
    case "conflict":
      return `${who} has a setting Ledgr won't overwrite.`;
    case "refused-url":
      // Names the host at most, never the full URL.
      return e.message;
    default:
      return `${who} didn't answer properly — try again.`;
  }
}

/** An error a client raises itself, naming its service. */
export function serviceError(
  service: string,
  message: string,
  code: BudgetApiErrorCode,
  status: number | null = null,
): BudgetApiError {
  const e = new BudgetApiError(message, code, status);
  e.service = service;
  return e;
}

/** A BudgetApiError with a new message, keeping what it knows. */
export function retold(from: BudgetApiError, message: string): BudgetApiError {
  const e = new BudgetApiError(
    message,
    from.code,
    from.status,
    from.retryAfterSeconds,
  );
  e.service = from.service;
  e.field = from.field;
  return e;
}

/** A write that stopped: `done` tells the user what had changed. Only a
 *  site that knows what changed says so; the default says nothing. */
export class WriteStopped extends Error {
  readonly done: string;

  constructor(message: string, done: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WriteStopped";
    this.done = done;
  }
}

/** A failure before anything was written. */
export function nothingChanged(cause: unknown): WriteStopped {
  return new WriteStopped(
    cause instanceof Error ? cause.message : String(cause),
    "Nothing was changed.",
    cause,
  );
}

/** The service failure behind an error, and what it stopped, if any. */
export function externalFailure(error: unknown): {
  external: BudgetApiError | null;
  stopped: WriteStopped | null;
} {
  let external: BudgetApiError | null = null;
  let stopped: WriteStopped | null = null;
  for (let c = error, i = 0; c instanceof Error && i < 6; i++) {
    if (c instanceof WriteStopped) stopped ??= c;
    if (c instanceof BudgetApiError) external ??= c;
    c = c.cause;
  }
  return { external, stopped };
}

/** The sentence a user sees for an error, or null when no service failed
 *  and no write says what stopped. */
export function userMessageFor(error: unknown): string | null {
  const { external, stopped } = externalFailure(error);
  const what = external && externalErrorSentence(external);
  if (stopped) return `${what ?? "Something went wrong."} ${stopped.done}`;
  return what;
}

/** A failure that may pass on its own (rate limit, 5xx, network, timeout):
 *  the only kind a caller may retry, skip or count per item. Anything else
 *  (auth, a rejected request, an unexpected response) won't change by
 *  trying again and must stop the operation. */
export function isTransientError(err: unknown): boolean {
  return err instanceof BudgetApiError && err.isRetryable;
}

/**
 * Classify a failed fetch Response into a BudgetApiError, by status only:
 * a body can echo what was sent, so none goes into the message.
 * Reads Retry-After (seconds or an HTTP date) on a 429.
 */
export function classifyResponse(res: Response): BudgetApiError {
  const status = res.status;

  if (status === 401 || status === 403) {
    return new BudgetApiError(
      `Authentication failed (${status})`,
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
      `Upstream server error (${status})`,
      "server",
      status,
    );
  }
  if (status >= 400) {
    return new BudgetApiError(`Client error (${status})`, "client", status);
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
  // A URL's user name and password never reach a message.
  const msg = (err instanceof Error ? err.message : String(err)).replace(
    /\/\/[^\s/@]+@/g,
    "//",
  );
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
  /** Narrows which retryable failures are sent again (default: all). */
  canResend: (err: BudgetApiError) => boolean = () => true,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      const apiErr = classifyThrown(err);
      if (
        !apiErr.isRetryable ||
        !canResend(apiErr) ||
        attempt === maxAttempts
      ) {
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
 * Whether a failed request can be sent again. A request that failed with a
 * timeout, network or server error may still have been applied; sending a
 * read, a set (PUT/PATCH) or a delete again is harmless, but a POST creates
 * something and could create it twice. A POST is sent again only after a
 * rate limit, which rejects it before it runs.
 */
export function isResendable(err: BudgetApiError, init?: RequestInit): boolean {
  const method = (init?.method ?? "GET").toUpperCase();
  return method !== "POST" || err.code === "rate-limit";
}
