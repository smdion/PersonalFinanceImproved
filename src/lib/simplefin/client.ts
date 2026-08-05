// SimpleFIN Bridge client — read-only bank/brokerage balance aggregator.
// Protocol: https://www.simplefin.org/protocol.html
//
// A one-time setup token (base64) decodes to a claim URL. POSTing to that
// URL returns an Access URL with embedded HTTP Basic Auth credentials
// (scheme://user:pass@host/...), which is stored and reused for every
// subsequent /accounts call — no further token exchange needed.
//
// Phase 1 only reads balances (never transactions), so every request uses
// balances-only=1 to stay cheap against SimpleFIN's ~24-requests/day quota.

import {
  classifyResponse,
  classifyThrown,
  retryWithBackoff,
} from "@/lib/budget-api/errors";

const REQUEST_TIMEOUT_MS = 15_000;

export type SimplefinAccount = {
  id: string;
  name: string;
  balance: number;
  orgName: string;
};

type SimplefinAccountsResponse = {
  errors?: string[];
  accounts?: Array<{
    id: string;
    name: string;
    balance: string;
    org?: { name?: string };
  }>;
};

type ParsedAccessUrl = {
  baseUrl: string;
  authHeader: string;
};

/** Split a SimpleFIN access URL into its base URL and a Basic Auth header. */
function parseAccessUrl(accessUrl: string): ParsedAccessUrl {
  const url = new URL(accessUrl);
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
): Promise<T> {
  return retryWithBackoff(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
  });
}

function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return withRequest(url, init, (res) => res.json() as Promise<T>);
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
  const accessUrl = await requestText(claimUrl, { method: "POST" });
  return accessUrl.trim();
}

/**
 * Fetch balances-only account data for every account linked in SimpleFIN
 * Bridge under this access URL.
 */
export async function getAccounts(
  accessUrl: string,
): Promise<SimplefinAccount[]> {
  const { baseUrl, authHeader } = parseAccessUrl(accessUrl);
  const json = await requestJson<SimplefinAccountsResponse>(
    `${baseUrl}/accounts?balances-only=1`,
    { headers: { Authorization: authHeader } },
  );
  return (json.accounts ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    balance: Number(a.balance),
    orgName: a.org?.name ?? "",
  }));
}
