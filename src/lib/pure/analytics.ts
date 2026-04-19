/**
 * Pure business logic for the Analytics page.
 *
 * Covers:
 *   - computeAllocation  — actual allocation % per asset class from holdings
 *   - computeDrift       — actual vs. target allocation delta per asset class
 *   - computeBlendedER   — first-year blended expense ratio (a fact, not a projection)
 *   - aggregateHoldings  — combine holdings across multiple accounts (balance-weighted)
 *
 * None of these functions touch the DB or make any I/O calls.
 * Dollar values are never stored — all computations derive from weightBps + snapshot balance.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HoldingInput = {
  assetClassId: number | null;
  weightBps: number;
  expenseRatio: string | null;
};

export type AccountHoldingsInput = {
  /** Snapshot balance for this account (dollars). */
  accountBalance: number;
  holdings: HoldingInput[];
};

// ---------------------------------------------------------------------------
// computeAllocation
// ---------------------------------------------------------------------------

/**
 * Compute actual allocation fraction per asset class from holdings.
 *
 * Input: flat array of { assetClassId, weightBps }
 * Output: map of assetClassId → fraction (0.0–1.0)
 *
 * weightBps are expressed as a fraction of the account balance (0–10000).
 * We normalise by total classified weight so that unclassified holdings
 * don't distort the allocation view.
 *
 * Holdings with null assetClassId are excluded from the output map
 * (they appear in the coverage indicator, not the allocation chart).
 */
export function computeAllocation(
  holdings: Pick<HoldingInput, "assetClassId" | "weightBps">[],
): Map<number, number> {
  const totals = new Map<number, number>();
  let classifiedTotal = 0;

  for (const h of holdings) {
    if (h.assetClassId === null) continue;
    const prev = totals.get(h.assetClassId) ?? 0;
    totals.set(h.assetClassId, prev + h.weightBps);
    classifiedTotal += h.weightBps;
  }

  if (classifiedTotal === 0) return new Map();

  const result = new Map<number, number>();
  for (const [id, bps] of totals) {
    result.set(id, bps / classifiedTotal);
  }
  return result;
}

// ---------------------------------------------------------------------------
// computeDrift
// ---------------------------------------------------------------------------

/**
 * Drift = actual allocation fraction − target allocation fraction.
 *
 * Both maps use assetClassId as the key (same namespace: asset_class_params.id).
 * Returns a signed fraction — negative = underweight, positive = overweight.
 *
 * Asset classes that appear in one map but not the other are included:
 *   - In actual but not target: drift = +actual (no target to compare)
 *   - In target but not actual: drift = -target (fully underweight)
 */
export function computeDrift(
  actual: Map<number, number>,
  target: Map<number, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  const allIds = new Set([...actual.keys(), ...target.keys()]);

  for (const id of allIds) {
    const a = actual.get(id) ?? 0;
    const t = target.get(id) ?? 0;
    result.set(id, a - t);
  }
  return result;
}

// ---------------------------------------------------------------------------
// computeBlendedER
// ---------------------------------------------------------------------------

/**
 * Blended expense ratio — first-year fee as a fraction of total invested.
 *
 * This is a FACT (what you pay now), NOT a projection.
 * Multi-year compound fee drag requires a return assumption → engine territory.
 *
 * Formula: Σ(expenseRatio_i × weightBps_i) / Σ weightBps_i
 *
 * Only holdings with non-null expenseRatio contribute to the numerator.
 * Returns null if no holdings have an expense ratio set.
 */
export function computeBlendedER(
  holdings: Pick<HoldingInput, "weightBps" | "expenseRatio">[],
): number | null {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const h of holdings) {
    if (h.expenseRatio === null || h.expenseRatio === undefined) continue;
    const er = Number(h.expenseRatio);
    if (!Number.isFinite(er)) continue;
    weightedSum += er * h.weightBps;
    totalWeight += h.weightBps;
  }

  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

// ---------------------------------------------------------------------------
// aggregateHoldings
// ---------------------------------------------------------------------------

/**
 * Aggregate holdings across multiple accounts into a single flat array.
 *
 * Each holding's weightBps is re-scaled to reflect its proportion of the
 * combined balance across all accounts, so the output can be fed into
 * computeAllocation / computeBlendedER for an "all accounts" aggregate view.
 *
 * Accounts with zero balance are skipped (they would contribute 0 weight anyway).
 */
export function aggregateHoldings(
  accountHoldings: AccountHoldingsInput[],
): HoldingInput[] {
  const totalBalance = accountHoldings.reduce(
    (sum, a) => sum + a.accountBalance,
    0,
  );
  if (totalBalance === 0) return [];

  const result: HoldingInput[] = [];

  for (const account of accountHoldings) {
    if (account.accountBalance === 0) continue;
    const accountWeight = account.accountBalance / totalBalance;

    for (const h of account.holdings) {
      // Re-scale: holding's fraction of its account × account's fraction of total
      // expressed back in basis points (×10000).
      const scaledBps = Math.round(
        (h.weightBps / 10000) * accountWeight * 10000,
      );
      result.push({
        assetClassId: h.assetClassId,
        weightBps: scaledBps,
        expenseRatio: h.expenseRatio,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// coverageStatus
// ---------------------------------------------------------------------------

/**
 * Compute the coverage status for a set of holdings in one account.
 * Returns the sum in bps and whether it's within tolerance of 10000.
 *
 * Uses ANALYTICS_WEIGHT_COVERAGE_WARN_BPS tolerance — caller imports the constant.
 */
export function coverageStatus(
  holdings: Pick<HoldingInput, "weightBps">[],
  warnThresholdBps: number,
): { sumBps: number; status: "ok" | "under" | "over" } {
  const sumBps = holdings.reduce((s, h) => s + h.weightBps, 0);
  const delta = sumBps - 10000;
  if (Math.abs(delta) <= warnThresholdBps) return { sumBps, status: "ok" };
  if (delta > 0) return { sumBps, status: "over" };
  return { sumBps, status: "under" };
}
