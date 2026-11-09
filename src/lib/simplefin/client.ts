// SimpleFIN Bridge client (https://www.simplefin.org/protocol.html): a setup token
// claims an Access URL with Basic Auth credentials, reused for every call. The full
// request is never retried here; dev replay reads SIMPLEFIN_REPLAY_DIR instead.

import { z } from "zod/v4";
import { BudgetApiError, serviceError } from "@/lib/budget-api/errors";
import {
  externalRequest,
  parseExternal,
  type ExternalSource,
} from "@/lib/http/external-request";
import { checkOutboundUrl } from "@/lib/http/url-safety";
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
import { errorScope } from "@/lib/pure/sync/simplefin-reidentify";

/** Full responses (holdings + 90 days of transactions) are much larger. */
const FULL_REQUEST_TIMEOUT_MS = 60_000;

/** A claim or access URL (credentials already removed), checked as every
 *  outbound URL is: the setup token decodes straight into a request target. */
function checkedUrl(url: string | URL, context: string): URL {
  const check = checkOutboundUrl(url, "simplefin");
  if (!check.ok) throw new Error(`Invalid ${context}: ${check.reason}`);
  return check.url;
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
  let url: URL;
  try {
    url = new URL(accessUrl);
  } catch {
    throw new Error("Invalid SimpleFIN access URL: Not a valid URL");
  }
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";
  const checked = checkedUrl(url, "SimpleFIN access URL");
  return {
    baseUrl: checked.toString().replace(/\/$/, ""),
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
  options: Pick<
    Parameters<typeof externalRequest>[0],
    "maxAttempts" | "timeoutMs" | "onAttempt"
  >,
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
    // The setup token is single-use: once SimpleFIN has spent it, a resend
    // fails and the access URL it answered with is lost.
    maxAttempts: 1,
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
  checkedUrl(claimUrl, "SimpleFIN setup token");
  const accessUrl = (
    await requestAccessUrl(claimUrl, { method: "POST" })
  ).trim();
  // Refused before it's stored, not at the first sync.
  parseAccessUrl(accessUrl);
  return accessUrl;
}

type GetAccountsResult = {
  accounts: SimplefinAccount[];
  /**
   * Non-fatal provider errors (e.g. one institution needs re-auth) sent
   * with a usable accounts list, as the protocol allows. Shown to the user,
   * as SimpleFIN's developer docs ask, never only logged.
   */
  providerErrors: string[];
  /** Messages that aren't failures (e.g. "Requested date range exceeds
   *  limit of 90 days and was capped"): the data is complete. */
  notices?: string[];
  /** A transaction-history limit (days) the provider reported, if any. */
  windowLimitDays?: number | null;
  /** Account ids named by a v2 `errlist` entry, or sent in a shape Ledgr
   *  can't read: their data this run is not trustworthy. */
  accountIdsWithErrors: string[];
  /** Institutions an error may have left accounts out of (see errorScope). */
  errorScope: ReturnType<typeof errorScope>;
};

type GetAccountsOptions = {
  /**
   * Request holdings and transactions posted on or after this date
   * (protocol v2, pending included). Omit for a balances-only request.
   */
  startDate?: Date;
  /** Called once for the request sent (the quota), after its answer is
   *  read: `status` is null when none came, `error` null when it read. */
  onRequest?: (request: {
    status: number | null;
    error: unknown;
  }) => Promise<void>;
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
  let unreadable = 0;
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
      else unreadable++;
      const label =
        typeof name === "string" ? `"${name}"` : `#${i + 1} of ${raw.length}`;
      problems.push(`${e.message} (account ${label}, not updated this sync)`);
    }
  });
  return { accounts, problems, erroredIds, unreadable };
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
    throw serviceError(
      "SimpleFIN",
      `${checked.problems[0]}${said}`,
      "bad-response",
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
  // One institution failing doesn't invalidate the others' accounts.
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
        posted: t.posted > 0 ? t.posted : t.transacted_at!,
        transactedAt: t.transacted_at ?? null,
        amount: Number(t.amount),
        description: t.description,
        pending: t.pending ?? false,
      })),
    })),
    providerErrors,
    notices,
    windowLimitDays,
    errorScope: errorScope(json, checked, connectionNames, CAPPED_NOTICE),
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
  let okStatus: number | null = null;
  const body = await requestAccounts(
    `${baseUrl}/accounts?${query}`,
    { headers: { Authorization: authHeader } },
    {
      // Never retried here: every call counts against the daily quota, and
      // a timeout on a large response usually repeats.
      maxAttempts: 1,
      ...(options.startDate && { timeoutMs: FULL_REQUEST_TIMEOUT_MS }),
      // A failed request is reported now; one that answered, once read.
      onAttempt: async ({ status, error }) => {
        if (error) await options.onRequest?.({ status, error });
        else okStatus = status;
      },
    },
  );
  let result: GetAccountsResult;
  try {
    result = readAccounts([body]);
  } catch (error) {
    await options.onRequest?.({ status: okStatus, error });
    throw error;
  }
  await options.onRequest?.({ status: okStatus, error: null });
  return result;
}
