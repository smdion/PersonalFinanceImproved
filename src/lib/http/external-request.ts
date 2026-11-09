/**
 * The one transport for outside services (YNAB, Actual, SimpleFIN, Tiingo; SEC
 * shares `fetchChecked`): URL/address/redirect checks, timeouts and retries per
 * SERVICE_RULES, and schema-checked responses (`parseExternal`), never casts.
 */
import "server-only";
import { Agent, type Dispatcher } from "undici";
import { z } from "zod/v4";
import { log } from "@/lib/logger";
import {
  BudgetApiError,
  classifyResponse,
  classifyThrown,
  isResendable,
  retryWithBackoff,
  serviceError,
} from "@/lib/budget-api/errors";
import {
  BlockedAddressError,
  checkOutboundUrl,
  guardedLookup,
  opensPrivateAddress,
  plainLookup,
  type OutboundService,
} from "@/lib/http/url-safety";

export type ExternalService = Exclude<OutboundService, "sec">;

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
  service: OutboundService;
  endpoint: string;
};

const SERVICE_NAMES: Record<OutboundService, string> = {
  ynab: "YNAB",
  actual: "Actual",
  simplefin: "SimpleFIN",
  tiingo: "Tiingo",
  sec: "SEC",
};

/** Connections for a public-only service: a name is refused when it
 *  resolves to a private or local address. */
const PUBLIC_ONLY = new Agent({ connect: { lookup: guardedLookup() } });
/** Connections for a service open to private hosts (Actual), to whatever
 *  address its name resolves. */
const PRIVATE_OPEN = new Agent({ connect: { lookup: plainLookup() } });

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;

function refused(service: OutboundService, reason: string): BudgetApiError {
  const name = SERVICE_NAMES[service];
  return serviceError(
    name,
    `Ledgr won't connect to ${name}: ${reason}`,
    "refused-url",
  );
}

function checked(url: string | URL, service: OutboundService): URL {
  const check = checkOutboundUrl(url, service);
  if (!check.ok) throw refused(service, check.reason);
  return check.url;
}

function blockedCause(e: unknown): BlockedAddressError | null {
  for (let c = e, i = 0; c instanceof Error && i < 6; i++, c = c.cause)
    if (c instanceof BlockedAddressError) return c;
  return null;
}

/** One request, no redirect followed. `target` is the URL as given, so a
 *  caller's spelling reaches fetch unchanged. */
async function sendOnce(
  target: string,
  init: RequestInit,
  service: OutboundService,
): Promise<Response> {
  const options: RequestInit & { dispatcher: Dispatcher } = {
    ...init,
    redirect: "manual",
    dispatcher: opensPrivateAddress(service) ? PRIVATE_OPEN : PUBLIC_ONLY,
  };
  try {
    return await fetch(target, options);
  } catch (e) {
    const blocked = blockedCause(e);
    if (blocked) throw refused(service, blocked.message);
    throw e;
  }
}

/** Where a redirect may go: the same origin, or http to https on the same
 *  host with the same or default port. Any other hop: the reason refused. */
function redirectRefusal(
  from: URL,
  to: URL,
  status: number,
  method: string,
): string | null {
  if (from.protocol === "https:" && to.protocol === "http:")
    return "it redirected from https to http.";
  if (from.hostname !== to.hostname)
    return `it redirected to another host ("${to.hostname}"); Ledgr doesn't follow that.`;
  const upgrade =
    from.protocol === "http:" &&
    to.protocol === "https:" &&
    (to.port === "" || to.port === from.port);
  if (from.origin !== to.origin && !upgrade)
    return `it redirected to another port ("${to.host}"); Ledgr doesn't follow that.`;
  if (status <= 303 && method !== "GET" && method !== "HEAD")
    return `it redirected a ${method} with ${status}; Ledgr doesn't resend it as a GET.`;
  return null;
}

/** `fetch` for every outside service. The URL is checked before each
 *  request, the address at connect, and at most 3 redirects are followed,
 *  each on its own host only, so headers never reach another host. */
export async function fetchChecked(
  input: string,
  init: RequestInit,
  service: OutboundService,
): Promise<Response> {
  let url = checked(input, service);
  let target = input;
  const method = (init.method ?? "GET").toUpperCase();
  for (let hop = 0; ; hop++) {
    const res = await sendOnce(target, init, service);
    const location = REDIRECTS.has(res.status)
      ? res.headers.get("location")
      : null;
    if (location === null) return res;
    await res.body?.cancel().catch(() => undefined);
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw refused(service, "it redirected to something that isn't a URL.");
    }
    const why = redirectRefusal(url, next, res.status, method);
    if (why) throw refused(service, why);
    if (hop === MAX_REDIRECTS)
      throw refused(service, `it redirected more than ${MAX_REDIRECTS} times.`);
    url = checked(next, service);
    target = url.href;
  }
}

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
  /** Called once per attempt, retries included (a followed redirect is part
   *  of its attempt), after its answer is read: `error` is null for a 2xx
   *  answer that read as JSON (or text). */
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
      let status: number | null = null;
      let answer: unknown;
      try {
        const res = await fetchChecked(
          request.url,
          {
            ...request.init,
            headers: { ...request.headers, ...request.init?.headers },
            signal: controller.signal,
          },
          request.service,
        );
        status = res.status;
        if (!res.ok) {
          const error = classifyResponse(res);
          // Only Actual's client reads it ("no budget file is open").
          if (request.service === "actual")
            error.keepResponseText(await res.text().catch(() => ""));
          else await res.body?.cancel().catch(() => undefined);
          throw error;
        }
        const text = await res.text();
        if (request.read === "text") answer = text;
        else {
          try {
            answer = JSON.parse(text);
          } catch {
            // An HTML page from a proxy or sign-in screen, answered with a 200.
            throw new BudgetApiError(
              `${SERVICE_NAMES[request.service]}: ${endpointPattern(request.endpoint)}: not JSON`,
              "bad-response",
              null,
            );
          }
        }
      } catch (e) {
        // classifyThrown keeps a BudgetApiError and classifies AbortError
        // and network errors, so the retry decides whether to send again.
        const error = classifyThrown(e);
        clearTimeout(timeout);
        await noteAttempt({ status, error });
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      // After the timer is cleared: a slow note can't time the request out.
      await noteAttempt({ status, error: null });
      return answer;
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
