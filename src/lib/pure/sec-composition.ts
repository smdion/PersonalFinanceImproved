/**
 * What a fund holds, summed into fixed composition buckets from its SEC
 * N-PORT holdings. Pure. Works for any registered fund — nothing here is
 * specific to a fund family or ticker.
 *
 * - Long positions only (short and negative positions are left out).
 * - A holding that is itself a registered fund is "looked through": the
 *   caller resolves it (registry name match confirmed by LEI) and passes
 *   that fund's own composition, weighted by the holding's share.
 * - A holding that looked like a fund but couldn't be confirmed stays
 *   unresolved — it lowers `coverage` rather than being guessed.
 * - Every other holding is classified by SEC's own asset category and
 *   country tags.
 */
import type { CompositionBucket } from "@/lib/config/enum-values";

export type NportHolding = {
  name: string;
  lei: string | null;
  /** Percent of net assets, as filed (e.g. 6.08 = 6.08%). */
  pctVal: number;
  /** N-PORT asset category code (EC, EP, DBT, ABS-MBS, STIV, DE, …). */
  assetCat: string | null;
  /** ISO country of investment, "US" for domestic. */
  invCountry: string | null;
  /** "Long" | "Short" | "N/A" */
  payoffProfile: string | null;
  /**
   * N-PORT issuer category. "RF" = the holding is itself a registered fund
   * (SEC's own tag), e.g. a fund-of-funds' underlying funds, which the
   * asset-category and country tags describe only as "equity, US".
   */
  issuerCat?: string | null;
};

/** The holding is itself a fund (other than a money market fund, which is just cash). */
export function isFundHolding(
  h: Pick<NportHolding, "issuerCat" | "assetCat">,
): boolean {
  return h.issuerCat === "RF" && (h.assetCat ?? "").toUpperCase() !== "STIV";
}

export type Composition = Record<CompositionBucket, number> & {
  /** Share of the fund's long holdings that could be classified. */
  coverage: number;
};

export const EMPTY_BUCKETS: Record<CompositionBucket, number> = {
  us_equity: 0,
  intl_equity: 0,
  us_bond: 0,
  intl_bond: 0,
  tips: 0,
  cash: 0,
  other: 0,
};

const EQUITY = new Set(["EC", "EP"]);
const CASH = new Set(["STIV"]);

function isDebt(cat: string): boolean {
  return (
    cat === "DBT" || cat === "LON" || cat === "SN" || cat.startsWith("ABS")
  );
}

/** SEC's tags → a bucket. Domestic means invCountry "US". */
export function classifyByTags(
  h: Pick<NportHolding, "assetCat" | "invCountry">,
): CompositionBucket {
  const cat = (h.assetCat ?? "").toUpperCase();
  const domestic = (h.invCountry ?? "").toUpperCase() === "US";
  if (EQUITY.has(cat)) return domestic ? "us_equity" : "intl_equity";
  if (isDebt(cat)) return domestic ? "us_bond" : "intl_bond";
  if (CASH.has(cat)) return "cash";
  return "other";
}

/** How a holding was resolved by the caller. */
export type HoldingResolution =
  | { kind: "fund"; composition: Composition }
  | { kind: "unresolved_fund" }
  | { kind: "security" };

/**
 * Compose a fund from its holdings. `resolve` reports, per holding index,
 * whether it was looked through as a fund, looked like an unconfirmed fund,
 * or is an ordinary security.
 */
export function composeFund(
  holdings: readonly NportHolding[],
  resolve: (index: number) => HoldingResolution,
): Composition {
  const sums = { ...EMPTY_BUCKETS };
  let total = 0;
  let covered = 0;
  holdings.forEach((h, i) => {
    if (h.payoffProfile === "Short" || !(h.pctVal > 0)) return;
    total += h.pctVal;
    const r = resolve(i);
    if (r.kind === "unresolved_fund") return;
    if (r.kind === "fund") {
      // The underlying fund's own coverage scales how much of this holding is known.
      const known = h.pctVal * r.composition.coverage;
      for (const b of Object.keys(EMPTY_BUCKETS) as CompositionBucket[])
        sums[b] += known * r.composition[b];
      covered += known;
      return;
    }
    sums[classifyByTags(h)] += h.pctVal;
    covered += h.pctVal;
  });
  const out = { ...EMPTY_BUCKETS, coverage: total > 0 ? covered / total : 0 };
  if (covered > 0)
    for (const b of Object.keys(EMPTY_BUCKETS) as CompositionBucket[])
      out[b] = sums[b] / covered;
  return out;
}

/** Normalise a fund-series name for registry matching (case, spacing, punctuation, "&amp;"). */
export function normalizeSeriesName(name: string): string {
  return name
    .replace(/&amp;/gi, "&")
    .toLowerCase()
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}
