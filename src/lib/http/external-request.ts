/**
 * The one way Ledgr asks an outside service for something (YNAB, Actual,
 * SimpleFIN, Tiingo) and the one check every response passes before any
 * code reads it. SEC keeps its own transport in sec/client.ts (paced,
 * streamed, never retried).
 *
 * - Timeout, typed `BudgetApiError`s and retries with backoff (Retry-After
 *   honoured) for every service, by the rules in SERVICE_RULES.
 * - Then the response is checked against the endpoint's schema
 *   (`parseExternal`): what a caller gets is what the schema says, never a
 *   cast.
 */
import "server-only";
import { z } from "zod/v4";
import { log } from "@/lib/logger";
import {
  BudgetApiError,
  classifyResponse,
  classifyThrown,
  isResendable,
  retryWithBackoff,
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

const SERVICE_NAMES: Record<ExternalSource["service"], string> = {
  ynab: "YNAB",
  actual: "Actual",
  simplefin: "SimpleFIN",
  tiingo: "Tiingo",
  sec: "SEC",
};

/** An endpoint as a pattern: ids become `:id`, the query goes. */
function endpointPattern(endpoint: string): string {
  return endpoint
    .split("?")[0]!
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id",
    );
}

/** Check a response body against its endpoint's schema. A body that doesn't
 *  fit throws `bad-response` naming the service, endpoint and first fields
 *  ("Actual: /accounts/:id/balance: data: expected number, …"). */
export function parseExternal<S extends z.ZodType>(
  schema: S,
  body: unknown,
  source: ExternalSource,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  // One line per field and problem: a field missing from every item of a
  // list is reported once, with how many more.
  const byField = new Map<string, { line: string; more: number }>();
  for (const issue of result.error.issues) {
    const line = `${issue.path.join(".") || "(body)"}: ${issue.message.replace(/^Invalid input: /, "")}`;
    const key = line.replace(/(^|\.)\d+(?=\.|:)/g, "$1#");
    const seen = byField.get(key);
    if (seen) seen.more++;
    else byField.set(key, { line, more: 0 });
  }
  const fields = [...byField.values()]
    .slice(0, 3)
    .map(({ line, more }) => (more > 0 ? `${line} (+${more} more)` : line))
    .join("; ");
  const err = new BudgetApiError(
    `${SERVICE_NAMES[source.service]}: ${endpointPattern(source.endpoint)}: ${fields}`,
    "bad-response",
    null,
  );
  err.service = SERVICE_NAMES[source.service];
  err.field = result.error.issues[0]?.path.join(".") || undefined;
  throw err;
}

export async function externalRequest<S extends z.ZodType>(request: {
  service: ExternalService;
  /** The endpoint's path; messages show it as a pattern (ids as `:id`, no
   *  query). */
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
  /** Called once per HTTP request sent, retries included: `error` is null
   *  for a 2xx answer. */
  onAttempt?: (attempt: {
    status: number | null;
    error: BudgetApiError | null;
  }) => Promise<void>;
}): Promise<z.infer<S>> {
  const rule = SERVICE_RULES[request.service];
  const timeoutMs = request.timeoutMs ?? rule.timeoutMs;
  // Bookkeeping: its failure is logged, never retried or thrown.
  const noteAttempt = async (attempt: {
    status: number | null;
    error: BudgetApiError | null;
  }) => {
    try {
      await request.onAttempt?.(attempt);
    } catch (e) {
      log("warn", "external_request.on_attempt_failed", {
        service: request.service,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  const body = await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response | undefined;
      try {
        res = await fetch(request.url, {
          ...request.init,
          headers: { ...request.headers, ...request.init?.headers },
          signal: controller.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw classifyResponse(res, text);
        }
        await noteAttempt({ status: res.status, error: null });
        if (request.read === "text") return await res.text();
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          // An HTML page from a proxy or sign-in screen, answered with a 200.
          throw new BudgetApiError(
            `${SERVICE_NAMES[request.service]}: ${endpointPattern(request.endpoint)}: not JSON`,
            "bad-response",
            null,
          );
        }
      } catch (e) {
        // classifyThrown keeps a BudgetApiError and classifies AbortError
        // and network errors, so the retry decides whether to send again.
        const error = classifyThrown(e);
        if (!res?.ok) await noteAttempt({ status: res?.status ?? null, error });
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    request.maxAttempts ?? rule.maxAttempts,
    (err: BudgetApiError) =>
      (rule.resend === "all" || isResendable(err, request.init)) &&
      (rule.onRateLimit === "retry" || err.code !== "rate-limit"),
  ).catch((e: unknown) => {
    if (e instanceof BudgetApiError)
      e.service ??= SERVICE_NAMES[request.service];
    throw e;
  });
  return parseExternal(request.schema, body, request);
}
