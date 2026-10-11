/**
 * Turn SimpleFIN holdings into security identities and holding-observation
 * rows. Pure — no DB or network.
 */
import {
  CASH_LIKE_DESCRIPTION_PATTERNS,
  MUTUAL_FUND_TICKER_PATTERN,
} from "@/lib/config/security-patterns";
import type { SecurityKind } from "@/lib/config/enum-values";

export type HoldingInput = {
  symbol: string;
  description: string;
  shares: number;
  marketValue: number | null;
  costBasisPerShare: number | null;
};

export type SecurityIdentity = {
  /** Identity key within this ingest: institution + description. */
  key: string;
  sourceSymbol: string | null;
  name: string;
  kind: SecurityKind;
  institution: string;
  sourceDescription: string;
};

/** Best-effort kind from what the institution sent; refined once a ticker is validated. */
export function inferSecurityKind(
  symbol: string,
  description: string,
): SecurityKind {
  if (CASH_LIKE_DESCRIPTION_PATTERNS.some((p) => p.test(description))) {
    return "money_market";
  }
  if (!symbol) return "plan_fund";
  if (MUTUAL_FUND_TICKER_PATTERN.test(symbol.toUpperCase()))
    return "mutual_fund";
  return "other";
}

/**
 * Identity for a holding. Until a ticker is validated (v0.8.6), a security
 * is identified by institution + description: the same symbol can be a
 * plan pseudo-symbol at one institution, so the raw symbol is never trusted
 * as a ticker on its own.
 */
export function securityIdentity(
  institution: string,
  holding: HoldingInput,
): SecurityIdentity {
  const description =
    holding.description || holding.symbol || "Unknown holding";
  return {
    key: `${institution}\u0000${description}`,
    sourceSymbol: holding.symbol || null,
    name: description,
    kind: inferSecurityKind(holding.symbol, holding.description),
    institution,
    sourceDescription: description,
  };
}

/** Whether an account's holdings include anything besides cash-like positions. */
export function hasInvestedHoldings(
  holdings: readonly HoldingInput[] | null,
): boolean {
  return (holdings ?? []).some(
    (h) => inferSecurityKind(h.symbol, h.description) !== "money_market",
  );
}

export type ObservationPlan =
  | { status: "unknown"; reason: "no_holdings_reported" }
  | {
      status: "ok";
      rows: Array<{
        key: string;
        shares: number;
        marketValue: number | null;
        costBasisPerShare: number | null;
      }>;
    };

/**
 * What to record for one account on one valuation date.
 *
 * - A non-empty holdings list is the account's full position list: every
 *   holding is recorded, and a security held at the previous observation but
 *   missing now is recorded as 0 shares (institutions drop sold positions
 *   rather than sending zero).
 * - A missing or empty list when the account previously held something is
 *   "unknown", not "sold everything" — nothing is recorded.
 */
export function planHoldingObservations(
  institution: string,
  holdings: readonly HoldingInput[] | null,
  previouslyHeld: ReadonlyMap<string, number>,
): ObservationPlan {
  const anyPreviouslyHeld = [...previouslyHeld.values()].some((s) => s > 0);
  if (!holdings || holdings.length === 0) {
    return anyPreviouslyHeld
      ? { status: "unknown", reason: "no_holdings_reported" }
      : { status: "ok", rows: [] };
  }
  const rows = new Map<
    string,
    {
      key: string;
      shares: number;
      marketValue: number | null;
      costBasisPerShare: number | null;
    }
  >();
  for (const h of holdings) {
    const { key } = securityIdentity(institution, h);
    const prior = rows.get(key);
    // The same fund can appear twice (e.g. separate lots/sources): add them up.
    rows.set(key, {
      key,
      shares: (prior?.shares ?? 0) + h.shares,
      marketValue:
        prior?.marketValue != null || h.marketValue != null
          ? (prior?.marketValue ?? 0) + (h.marketValue ?? 0)
          : null,
      costBasisPerShare: prior ? null : h.costBasisPerShare,
    });
  }
  for (const [key, shares] of previouslyHeld) {
    if (shares > 0 && !rows.has(key)) {
      rows.set(key, {
        key,
        shares: 0,
        marketValue: 0,
        costBasisPerShare: null,
      });
    }
  }
  return { status: "ok", rows: [...rows.values()] };
}
