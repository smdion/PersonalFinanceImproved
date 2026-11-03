/**
 * The one way Ledgr asks an outside service for something (YNAB, Actual,
 * SimpleFIN, Tiingo) and the one check every response passes before any
 * code reads it (SEC's streamed files call `parseExternal` on what they
 * parse; their transport stays in sec/client.ts: paced, streamed, never
 * retried).
 *
 * - Timeout, typed `BudgetApiError`s and retries with backoff (Retry-After
 *   honoured) for every service, by the rules in SERVICE_RULES.
 * - Then the response is checked against the endpoint's schema
 *   (`parseExternal`): what a caller gets is what the schema says, never a
 *   cast.
 */
import "server-only";
import { z } from "zod/v4";
import {
  classifyResponse,
  classifyThrown,
  isResendable,
  retryWithBackoff,
  type BudgetApiError,
} from "@/lib/budget-api/errors";

export type ExternalService = "ynab" | "actual" | "simplefin" | "tiingo";

type ServiceRule = {
  timeoutMs: number;
  maxAttempts: number;
  /** Which retryable failures are sent again: "safe" (a POST only after a
   *  rate limit, isResendable) or "all". */
  resend: "safe" | "all";
  /** "fail": an hourly or daily quota (Tiingo) won't lift in seconds, and
   *  each retry spends another request. */
  onRateLimit: "retry" | "fail";
};

/** Each service's request rules, in one place. */
const SERVICE_RULES: Record<ExternalService, ServiceRule> = {
  ynab: {
    timeoutMs: 15_000,
    maxAttempts: 3,
    resend: "safe",
    onRateLimit: "retry",
  },
  actual: {
    timeoutMs: 15_000,
    maxAttempts: 3,
    resend: "safe",
    onRateLimit: "retry",
  },
  tiingo: {
    timeoutMs: 15_000,
    maxAttempts: 3,
    resend: "safe",
    onRateLimit: "fail",
  },
  simplefin: {
    timeoutMs: 15_000,
    maxAttempts: 3,
    resend: "all",
    onRateLimit: "retry",
  },
};

/** Where a response came from, for the message when it doesn't check out. */
export type ExternalSource = {
  service: ExternalService | "sec";
  endpoint: string;
};

/** Accepts any body, typed as T: an endpoint's placeholder until its own
 *  schema is written. */
export function uncheckedShape<T>(): z.ZodType<T> {
  return z.custom<T>(() => true);
}

/** Check a response body against its endpoint's schema. */
export function parseExternal<S extends z.ZodType>(
  schema: S,
  body: unknown,
  _source: ExternalSource,
): z.infer<S> {
  return schema.parse(body);
}

export async function externalRequest<S extends z.ZodType>(request: {
  service: ExternalService;
  /** The endpoint's path pattern (e.g. "/accounts/:id/balance"). */
  endpoint: string;
  url: string;
  schema: S;
  headers?: Record<string, string>;
  init?: RequestInit;
  /** "json" (default) or "text". */
  read?: "json" | "text";
  /** Overrides of the service's rule for this call. */
  maxAttempts?: number;
  timeoutMs?: number;
}): Promise<z.infer<S>> {
  const rule = SERVICE_RULES[request.service];
  const timeoutMs = request.timeoutMs ?? rule.timeoutMs;
  const body = await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(request.url, {
          ...request.init,
          headers: { ...request.headers, ...request.init?.headers },
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw classifyResponse(res, text);
        }
        const parsed: unknown =
          request.read === "text" ? await res.text() : await res.json();
        return parsed;
      } catch (e) {
        // classifyThrown keeps a BudgetApiError and classifies AbortError
        // and network errors, so the retry decides whether to send again.
        throw classifyThrown(e);
      } finally {
        clearTimeout(timeout);
      }
    },
    request.maxAttempts ?? rule.maxAttempts,
    (err: BudgetApiError) =>
      (rule.resend === "all" || isResendable(err, request.init)) &&
      (rule.onRateLimit === "retry" || err.code !== "rate-limit"),
  );
  return parseExternal(request.schema, body, request);
}
