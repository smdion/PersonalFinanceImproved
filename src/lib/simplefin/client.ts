// SimpleFIN Bridge client — read-only bank/brokerage balance aggregator.
// Protocol: https://www.simplefin.org/protocol.html
//
// A one-time setup token (base64) decodes to a claim URL. POSTing to that
// URL returns an Access URL with embedded HTTP Basic Auth credentials
// (scheme://user:pass@host/...), which is stored and reused for every
// subsequent /accounts call — no further token exchange needed.
//
// Two request shapes: balances-only (the connection test) and full
// (holdings + transactions, protocol version 2, used by the daily sync).
// SimpleFIN Bridge allows ~24 requests/day per access URL; the full request
// is never retried here — the sync layer counts every call and decides.
//
// Replay mode (development only): when SIMPLEFIN_REPLAY_DIR is set and
// NODE_ENV is not "production", getAccounts reads saved responses from that
// directory instead of calling SimpleFIN, so a dev instance never shares a
// production connection's daily quota.

import { z } from "zod/v4";
import { BudgetApiError } from "@/lib/budget-api/errors";
import {
  externalRequest,
  parseExternal,
  type ExternalSource,
} from "@/lib/http/external-request";
import { log } from "@/lib/logger";
import { promises as fs } from "fs";
import path from "path";
import {
  simplefinAccountSchema,
  simplefinHoldingSchema,
  simplefinSchemas,
  simplefinTransactionSchema,
  type SimplefinAccountsBody,
  type SimplefinRawAccount,
} from "./schemas";

/** Full responses (holdings + 90 days of transactions) are much larger. */
const FULL_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Reject decoded claim/access URLs that don't point at a real external
 * HTTPS host — the setup token is base64-decoded straight into a fetch()
 * target, so a malformed or tampered token must not be able to make the
 * server reach internal/private/loopback/link-local/metadata addresses.
 */
function assertSafeRemoteUrl(rawUrl: string, context: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${context}: not a URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Invalid ${context}: must be HTTPS`);
  }
  // url.hostname keeps brackets for IPv6 literals ("[::1]") — strip them so
  // the checks below actually match the address.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isBlockedHost =
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".internal") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    // IPv6 loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
    // and IPv4-mapped private ranges (::ffff:10.x, ::ffff:192.168.x, etc.)
    hostname === "::1" ||
    /^fe80:/.test(hostname) ||
    /^f[cd][0-9a-f]{2}:/.test(hostname) ||
    /^::ffff:(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(
      hostname,
    );
  if (isBlockedHost) {
    throw new Error(`Invalid ${context}: private/internal host not allowed`);
  }
  return url;
}

type SimplefinHolding = {
  /** Symbol as sent — may be empty or a plan pseudo-symbol. */
  symbol: string;
  description: string;
  shares: number;
  marketValue: number | null;
  /** Average cost per share when the institution sends one (0 means "not sent"). */
  costBasisPerShare: number | null;
};

type SimplefinTransaction = {
  id: string;
  /** Unix seconds. */
  posted: number;
  transactedAt: number | null;
  amount: number;
  description: string;
  pending: boolean;
};

export type SimplefinAccount = {
  id: string;
  name: string;
  balance: number;
  orgName: string;
  /** SimpleFIN `balance-date`, when sent. */
  balanceDate: Date | null;
  /** null = the response had no `holdings` field (balances-only, or not supported). */
  holdings: SimplefinHolding[] | null;
  transactions: SimplefinTransaction[];
};

type ParsedAccessUrl = {
  baseUrl: string;
  authHeader: string;
};

/** Split a SimpleFIN access URL into its base URL and a Basic Auth header. */
function parseAccessUrl(accessUrl: string): ParsedAccessUrl {
  const url = assertSafeRemoteUrl(accessUrl, "SimpleFIN access URL");
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

/** Where every accounts answer, live or replayed, comes from: a fixed name,
 *  never the URL (SimpleFIN URLs carry credentials). */
const ACCOUNTS: ExternalSource = {
  service: "simplefin",
  endpoint: "/accounts",
};

/** The accounts answer as JSON; readAccounts checks it, where live and
 *  replayed answers meet. */
function requestAccounts(
  url: string,
  init: RequestInit,
  options?: { maxAttempts?: number; timeoutMs?: number },
): Promise<unknown> {
  return externalRequest({
    service: "simplefin",
    endpoint: ACCOUNTS.endpoint,
    url,
    init,
    schema: z.unknown(),
    ...options,
  });
}

function requestAccessUrl(url: string, init: RequestInit): Promise<string> {
  return externalRequest({
    service: "simplefin",
    // The claim URL's path is the one-time setup token.
    endpoint: "/claim",
    url,
    init,
    read: "text",
    schema: simplefinSchemas.accessUrl,
  });
}

/**
 * Claim a one-time SimpleFIN setup token for a long-lived access URL.
 * The setup token is base64 of the claim URL; POSTing to it (empty body)
 * returns the access URL as the response body.
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken, "base64").toString("utf8");
  assertSafeRemoteUrl(claimUrl, "SimpleFIN setup token");
  const accessUrl = await requestAccessUrl(claimUrl, { method: "POST" });
  return accessUrl.trim();
}

type GetAccountsResult = {
  accounts: SimplefinAccount[];
  /**
   * Non-fatal provider errors (e.g. one linked institution needs re-auth)
   * that arrived alongside a usable accounts list — per the SimpleFIN
   * protocol, `errors` and `accounts` can both be populated in the same
   * response. Callers should surface these to the user (SimpleFIN's own
   * developer docs ask API consumers to display `errlist`/`errors`, not
   * just log them), not silently drop them.
   */
  providerErrors: string[];
  /**
   * Informational messages that aren't failures (e.g. "Requested date range
   * exceeds limit of 90 days and was capped") — the data is complete for
   * what the provider keeps.
   */
  notices?: string[];
  /** A transaction-history limit (days) the provider reported, if any. */
  windowLimitDays?: number | null;
  /** Account ids named by a v2 `errlist` entry, or sent in a shape Ledgr
   *  can't read: their data this run is not trustworthy. */
  accountIdsWithErrors: string[];
};

type GetAccountsOptions = {
  /**
   * Request holdings and transactions posted on or after this date
   * (protocol v2, pending included). Omit for a balances-only request.
   */
  startDate?: Date;
};

/** A money field that may not be sent: absent or "" is null. */
const num = (v: string | undefined): number | null =>
  v === undefined || v === "" ? null : Number(v);

/** A message saying our requested history was trimmed to the provider's limit — informational, not an error. */
const CAPPED_NOTICE = /date range.*\bcapped\b/i;
const LIMIT_DAYS = /limit of (\d+) days?/i;

/**
 * An account's institution: v2 resolves it through the account's
 * connection; v1 sent it on the account. None of them sent: "".
 */
function institutionName(
  a: SimplefinRawAccount,
  connectionNames: ReadonlyMap<string, string>,
): string {
  return (
    (a.conn_id ? connectionNames.get(a.conn_id) : undefined) ??
    a.conn_name ??
    a.org?.name ??
    ""
  );
}

/** Items checked one by one: the ones that fit, and what was wrong with the
 *  others (field named with its index), or null when all fit. */
function checkItems<S extends z.ZodType>(
  field: string,
  schema: S,
  items: readonly unknown[],
): { ok: z.infer<S>[]; problem: string | null } {
  const ok = items.flatMap((item) => {
    const r = schema.safeParse(item);
    return r.success ? [r.data as z.infer<S>] : [];
  });
  if (ok.length === items.length) return { ok, problem: null };
  try {
    parseExternal(
      z.looseObject({ [field]: z.array(schema) }),
      { [field]: items },
      ACCOUNTS,
    );
  } catch (e) {
    if (e instanceof BudgetApiError) return { ok, problem: e.message };
    throw e;
  }
  return { ok, problem: null };
}

/**
 * An account's holdings and transactions, checked. A bad holding makes the
 * list unknown (null): a list missing a fund would read as sold. A bad
 * transaction is left out; the account is errored so it's asked for again.
 */
function withItems(a: SimplefinRawAccount) {
  const holdings =
    a.holdings && checkItems("holdings", simplefinHoldingSchema, a.holdings);
  const transactions = checkItems(
    "transactions",
    simplefinTransactionSchema,
    a.transactions ?? [],
  );
  const problems = [
    holdings?.problem &&
      `${holdings.problem} (account "${a.name}": holdings kept as last known)`,
    transactions.problem &&
      `${transactions.problem} (account "${a.name}": those transactions left out)`,
  ].filter((p): p is string => !!p);
  const ok = holdings && !holdings.problem ? holdings.ok : null;
  return { a, holdings: ok, transactions: transactions.ok, problems };
}

/**
 * Each account checked on its own: one whose own fields don't fit is left
 * out and reported; one with a bad holding or transaction is kept. Either
 * way its id (when readable) is errored.
 */
function checkAccounts(raw: readonly unknown[]) {
  const accounts: ReturnType<typeof withItems>[] = [];
  const problems: string[] = [];
  const erroredIds: string[] = [];
  raw.forEach((item, i) => {
    try {
      const checked = withItems(
        parseExternal(simplefinAccountSchema, item, ACCOUNTS),
      );
      accounts.push(checked);
      problems.push(...checked.problems);
      if (checked.problems.length > 0) erroredIds.push(checked.a.id);
    } catch (e) {
      if (!(e instanceof BudgetApiError)) throw e;
      const { id, name } = (item ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id === "string") erroredIds.push(id);
      const label =
        typeof name === "string" ? `"${name}"` : `#${i + 1} of ${raw.length}`;
      problems.push(`${e.message} (account ${label}, not updated this sync)`);
    }
  });
  return { accounts, problems, erroredIds };
}

function mapResponse(
  json: SimplefinAccountsBody & { accounts: unknown[] },
): GetAccountsResult {
  const connectionNames = new Map(
    (json.connections ?? [])
      .map((c) => [c.conn_id, (c.org_name ?? c.name).trim()] as const)
      .filter(([, name]) => name !== ""),
  );
  const checked = checkAccounts(json.accounts);
  const errlist = json.errlist ?? [];
  const messages = [...(json.errors ?? []), ...errlist.map((e) => e.msg)];
  // No account fits: the answer as a whole is bad.
  if (json.accounts.length > 0 && checked.accounts.length === 0) {
    const said =
      messages.length > 0 ? `; SimpleFIN said: ${messages.join("; ")}` : "";
    throw new BudgetApiError(
      `${checked.problems[0]}${said}`,
      "bad-response",
      null,
    );
  }
  const notices = messages.filter((m) => CAPPED_NOTICE.test(m));
  const providerErrors = [
    ...messages.filter((m) => !CAPPED_NOTICE.test(m)),
    ...checked.problems,
  ];
  const windowLimitDays =
    notices
      .map((m) => Number(m.match(LIMIT_DAYS)?.[1]))
      .find((n) => Number.isFinite(n) && n > 0) ?? null;
  if (notices.length > 0)
    log("info", "simplefin_window_capped", { windowLimitDays });
  if (providerErrors.length > 0 && checked.accounts.length === 0) {
    throw new Error(`SimpleFIN provider error: ${providerErrors.join("; ")}`);
  }
  // Per the SimpleFIN protocol, errors can arrive alongside a populated
  // `accounts` array — one linked institution failing (e.g. needs re-auth)
  // doesn't invalidate data successfully fetched for others.
  if (providerErrors.length > 0) {
    log("warn", "simplefin_partial_provider_error", {
      errorCount: providerErrors.length,
    });
  }
  return {
    accounts: checked.accounts.map(({ a, holdings, transactions }) => ({
      id: a.id,
      name: a.name,
      balance: Number(a.balance),
      orgName: institutionName(a, connectionNames),
      balanceDate:
        a["balance-date"] !== undefined
          ? new Date(a["balance-date"] * 1000)
          : null,
      holdings:
        holdings === null
          ? null
          : holdings.map((h) => {
              const cost = num(h.cost_basis);
              return {
                symbol: (h.symbol ?? "").trim(),
                description: h.description.trim(),
                shares: Number(h.shares),
                marketValue: num(h.market_value),
                costBasisPerShare: cost !== null && cost > 0 ? cost : null,
              };
            }),
      transactions: transactions.map((t) => ({
        id: t.id,
        posted: t.posted,
        transactedAt: t.transacted_at ?? null,
        amount: Number(t.amount),
        description: t.description,
        pending: t.pending ?? false,
      })),
    })),
    providerErrors,
    notices,
    windowLimitDays,
    // A notice isn't an account failure, even if the provider scoped it to
    // one. A connection-level error (e.g. "sign in again") covers every
    // account on that connection.
    accountIdsWithErrors: [
      ...new Set([
        ...checked.erroredIds,
        ...errlist
          .filter((e) => !CAPPED_NOTICE.test(e.msg))
          .flatMap((e) =>
            e.account_id
              ? [e.account_id]
              : e.conn_id
                ? checked.accounts
                    .filter(({ a }) => a.conn_id === e.conn_id)
                    .map(({ a }) => a.id)
                : [],
          ),
      ]),
    ],
  };
}

/** Check every answer (one live, or each saved one) and read them as one. */
function readAccounts(bodies: readonly unknown[]): GetAccountsResult {
  const parsed = bodies.map((b) =>
    parseExternal(simplefinSchemas.accounts, b, ACCOUNTS),
  );
  return mapResponse({
    errors: parsed.flatMap((p) => p.errors ?? []),
    errlist: parsed.flatMap((p) => p.errlist ?? []),
    connections: parsed.flatMap((p) => p.connections ?? []),
    accounts: parsed.flatMap((p) => p.accounts ?? []),
  });
}

/** Replay mode: saved responses instead of real calls — never in production. */
export function isSimplefinReplayMode(): boolean {
  return (
    !!process.env.SIMPLEFIN_REPLAY_DIR && process.env.NODE_ENV !== "production"
  );
}

/** Development-only: read saved responses instead of calling SimpleFIN. */
async function readReplayResponses(dir: string): Promise<GetAccountsResult> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
  const bodies: unknown[] = [];
  for (const f of files.sort()) {
    bodies.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")));
  }
  return readAccounts(bodies);
}

/**
 * Fetch account data for every account linked in SimpleFIN Bridge under
 * this access URL — balances only, or (with `startDate`) holdings and
 * transactions too.
 */
export async function getAccounts(
  accessUrl: string,
  options: GetAccountsOptions = {},
): Promise<GetAccountsResult> {
  if (isSimplefinReplayMode()) {
    return readReplayResponses(process.env.SIMPLEFIN_REPLAY_DIR!);
  }
  const { baseUrl, authHeader } = parseAccessUrl(accessUrl);
  const query = options.startDate
    ? `version=2&pending=1&start-date=${Math.floor(options.startDate.getTime() / 1000)}`
    : "balances-only=1";
  const body = await requestAccounts(
    `${baseUrl}/accounts?${query}`,
    { headers: { Authorization: authHeader } },
    // Full requests are never retried here: every call counts against the
    // daily quota, and a timeout on a large response usually repeats.
    options.startDate
      ? { maxAttempts: 1, timeoutMs: FULL_REQUEST_TIMEOUT_MS }
      : undefined,
  );
  return readAccounts([body]);
}
