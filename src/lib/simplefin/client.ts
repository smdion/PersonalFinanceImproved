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

import {
  classifyResponse,
  classifyThrown,
  retryWithBackoff,
} from "@/lib/budget-api/errors";
import { log } from "@/lib/logger";
import { promises as fs } from "fs";
import path from "path";

const REQUEST_TIMEOUT_MS = 15_000;
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

export type SimplefinHolding = {
  id: string;
  /** Symbol as sent — may be empty or a plan pseudo-symbol. */
  symbol: string;
  description: string;
  shares: number;
  marketValue: number | null;
  /** Average cost per share when the institution sends one (0 means "not sent"). */
  costBasisPerShare: number | null;
};

export type SimplefinTransaction = {
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

type SimplefinAccountsResponse = {
  errors?: string[];
  /**
   * Protocol v2: the institutions behind the accounts. An account names
   * its connection by `conn_id`; v1's per-account `org` is gone.
   */
  connections?: Array<{
    conn_id: string;
    name?: string;
    /** Not in the attribute tables, but present in the protocol's samples. */
    org_name?: string;
    org_id?: string;
  }>;
  /** Protocol v2: structured errors, optionally scoped to an account/connection. */
  errlist?: Array<{
    code?: string;
    msg?: string;
    account_id?: string;
    conn_id?: string;
  }>;
  accounts?: Array<{
    id: string;
    name: string;
    balance: string;
    "balance-date"?: number;
    /** Protocol v1 only. */
    org?: { name?: string };
    /** Protocol v2: the connection (institution) this account belongs to. */
    conn_id?: string;
    /** Present in the protocol's samples. */
    conn_name?: string;
    holdings?: Array<{
      id?: string;
      symbol?: string;
      description?: string;
      shares?: string;
      market_value?: string;
      cost_basis?: string;
    }>;
    transactions?: Array<{
      id: string;
      posted: number;
      transacted_at?: number;
      amount: string;
      description?: string;
      pending?: boolean;
    }>;
  }>;
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

/**
 * Fetch wrapper shared by claim + accounts calls. Throws typed
 * BudgetApiError (auth/rate-limit/server/network/timeout) instead of a
 * generic Error, wrapped in the same retryWithBackoff (exponential,
 * honors Retry-After on 429) used by the YNAB/Actual clients.
 */
async function withRequest<T>(
  url: string,
  init: RequestInit | undefined,
  parse: (res: Response) => Promise<T>,
  { maxAttempts = 3, timeoutMs = REQUEST_TIMEOUT_MS } = {},
): Promise<T> {
  return retryWithBackoff(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw classifyResponse(res, body);
      }
      return await parse(res);
    } catch (e) {
      throw classifyThrown(e);
    } finally {
      clearTimeout(timeout);
    }
  }, maxAttempts);
}

function requestJson<T>(
  url: string,
  init?: RequestInit,
  options?: { maxAttempts?: number; timeoutMs?: number },
): Promise<T> {
  return withRequest(url, init, (res) => res.json() as Promise<T>, options);
}

function requestText(url: string, init?: RequestInit): Promise<string> {
  return withRequest(url, init, (res) => res.text());
}

/**
 * Claim a one-time SimpleFIN setup token for a long-lived access URL.
 * The setup token is base64 of the claim URL; POSTing to it (empty body)
 * returns the access URL as the response body.
 */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = Buffer.from(setupToken, "base64").toString("utf8");
  assertSafeRemoteUrl(claimUrl, "SimpleFIN setup token");
  const accessUrl = await requestText(claimUrl, { method: "POST" });
  return accessUrl.trim();
}

export type GetAccountsResult = {
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
  /** Account ids named by a v2 `errlist` entry — their data this run is not trustworthy. */
  accountIdsWithErrors: string[];
};

export type GetAccountsOptions = {
  /**
   * Request holdings and transactions posted on or after this date
   * (protocol v2, pending included). Omit for a balances-only request.
   */
  startDate?: Date;
};

const num = (v: string | undefined): number | null =>
  v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

/** A message saying our requested history was trimmed to the provider's limit — informational, not an error. */
const CAPPED_NOTICE = /date range.*\bcapped\b/i;
const LIMIT_DAYS = /limit of (\d+) days?/i;

/**
 * An account's institution: v2 resolves it through the account's
 * connection; v1 sent it on the account.
 */
function institutionName(
  a: NonNullable<SimplefinAccountsResponse["accounts"]>[number],
  connectionNames: ReadonlyMap<string, string>,
): string {
  return (
    (a.conn_id ? connectionNames.get(a.conn_id) : undefined) ??
    a.conn_name ??
    a.org?.name ??
    ""
  );
}

function mapResponse(json: SimplefinAccountsResponse): GetAccountsResult {
  const errlist = json.errlist ?? [];
  const connectionNames = new Map(
    (json.connections ?? [])
      .map((c) => [c.conn_id, (c.org_name ?? c.name ?? "").trim()] as const)
      .filter(([, name]) => name !== ""),
  );
  const messages = [
    ...(json.errors ?? []),
    ...errlist.map((e) => e.msg ?? e.code ?? "Unknown SimpleFIN error"),
  ];
  const notices = messages.filter((m) => CAPPED_NOTICE.test(m));
  const providerErrors = messages.filter((m) => !CAPPED_NOTICE.test(m));
  const windowLimitDays =
    notices
      .map((m) => Number(m.match(LIMIT_DAYS)?.[1]))
      .find((n) => Number.isFinite(n) && n > 0) ?? null;
  if (notices.length > 0)
    log("info", "simplefin_window_capped", { windowLimitDays });
  const hasAccounts = json.accounts && json.accounts.length > 0;
  if (providerErrors.length > 0 && !hasAccounts) {
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
    accounts: (json.accounts ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      balance: Number(a.balance),
      orgName: institutionName(a, connectionNames),
      balanceDate:
        a["balance-date"] !== undefined
          ? new Date(a["balance-date"] * 1000)
          : null,
      holdings:
        a.holdings === undefined
          ? null
          : a.holdings.map((h) => {
              const cost = num(h.cost_basis);
              return {
                id: h.id ?? "",
                symbol: (h.symbol ?? "").trim(),
                description: (h.description ?? "").trim(),
                shares: num(h.shares) ?? 0,
                marketValue: num(h.market_value),
                costBasisPerShare: cost !== null && cost > 0 ? cost : null,
              };
            }),
      transactions: (a.transactions ?? []).map((t) => ({
        id: t.id,
        posted: t.posted,
        transactedAt: t.transacted_at ?? null,
        amount: Number(t.amount),
        description: t.description ?? "",
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
      ...new Set(
        errlist
          .filter((e) => !CAPPED_NOTICE.test(e.msg ?? ""))
          .flatMap((e) =>
            e.account_id
              ? [e.account_id]
              : e.conn_id
                ? (json.accounts ?? [])
                    .filter((a) => a.conn_id === e.conn_id)
                    .map((a) => a.id)
                : [],
          ),
      ),
    ],
  };
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
  const merged: SimplefinAccountsResponse = { accounts: [], errors: [] };
  for (const f of files.sort()) {
    const json = JSON.parse(
      await fs.readFile(path.join(dir, f), "utf8"),
    ) as SimplefinAccountsResponse;
    merged.accounts!.push(...(json.accounts ?? []));
    merged.errors!.push(...(json.errors ?? []));
  }
  return mapResponse(merged);
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
  const json = await requestJson<SimplefinAccountsResponse>(
    `${baseUrl}/accounts?${query}`,
    { headers: { Authorization: authHeader } },
    // Full requests are never retried here: every call counts against the
    // daily quota, and a timeout on a large response usually repeats.
    options.startDate
      ? { maxAttempts: 1, timeoutMs: FULL_REQUEST_TIMEOUT_MS }
      : undefined,
  );
  return mapResponse(json);
}
