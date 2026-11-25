/**
 * Draws the sources beyond the Traditional bracket cap by marginal cost: each dollar
 * from the source whose next dollar costs least in ordinary tax, gains tax, NIIT and
 * the benefits it makes taxable. No IRMAA, no look-ahead to later years.
 */
import { isQualifiedRothOwner } from "@/lib/pure/tax/roth-distribution-tax";
import type { TaxBuckets } from "../accounts/account-balances.types";
import { ltcgBracketAt, ltcgStackBase } from "@/lib/pure/tax/ltcg";
import {
  getAccountTypeConfig,
  isRetirementMoney,
  isTaxFreeBucket,
} from "../../config/account-types";
import type { AccountCategory } from "../../config/account-types";
import { NIIT_RATE, niitThresholdFor } from "../../config/niit";
import type { RothBasisState } from "@/lib/pure/accounts/roth-basis-tracking";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";
import {
  advance,
  cents,
  dollarMove,
  drawsGains,
  gainShareOf,
  gainsTaxBothWays,
  gap,
  ordinaryCostAt,
  socialSecurityInclusionAt,
} from "./draw-position";
import type {
  DrawPart,
  DrawSources,
  DrawState,
  WithdrawalSourceKind,
} from "./draw-position";

/**
 * Derives the Roth and brokerage ranking inputs once for both the real year
 * (decumulation-year.ts) and the solver's estimate, so they match (docs/RULES.md
 * single computation path). `magiBeforeThisDraw` is left to the router's floor.
 */
export function deriveBasisRankingInputs(params: {
  balances: Pick<TaxBuckets, "afterTax" | "afterTaxBasis">;
  /** Retirement brokerages' own basis ratio (brokerage-basis.ts), when basis is
   *  tracked per account; otherwise the aggregate. Capped at 1: ranking prices the gain. */
  brokerageBasisRatio?: number;
  indBasis?: Map<string, RothBasisState>;
  /** With `indKey`, drops basis held in Portfolio-parented accounts, which routing
   *  never draws from. Penalty-exposed accounts are not filtered: that exclusion
   *  depends on `avoidPenalizedWithdrawals`, which neither call site has. */
  indAccounts?: {
    name: string;
    category: AccountCategory;
    taxType: string;
    ownerPersonId?: number;
    ownerBirthYear?: number;
    parentCategory?: string;
  }[];
  indKey?: IndKeyFn;
  /** With both, a qualified owner's whole Roth balance is free capacity:
   *  growth past 59½ costs no more than basis does. */
  indBalance?: ReadonlyMap<string, number>;
  year?: number;
}): {
  /** The `basis_first` (Roth IRA) money a draw takes tax-free. */
  rothBasisAvailable: number | undefined;
  rothProRata: RothProRataHoldings | undefined;
  brokerageBasisRatio: number;
} {
  const { balances, indBasis, indAccounts, indKey, indBalance, year } = params;
  let rothBasisAvailable: number | undefined;
  let rothProRata: RothProRataHoldings | undefined;
  if (indBasis) {
    if (indAccounts && indKey) {
      const proRata = { balance: 0, basis: 0, qualifiedBalance: 0 };
      rothBasisAvailable = indAccounts.reduce((s, account) => {
        if (!isTaxFreeBucket(account.taxType)) return s;
        if (!isRetirementMoney(account.parentCategory)) return s;
        const balance = Math.max(0, indBalance?.get(indKey(account)) ?? 0);
        const state = indBasis.get(indKey(account));
        const qualified =
          indBalance !== undefined &&
          year !== undefined &&
          isQualifiedRothOwner(account.ownerBirthYear, year);
        const { rothOrderingRules } = getAccountTypeConfig(account.category);
        // Without balances a pro_rata Roth can't be split: its basis counts here.
        if (rothOrderingRules !== "pro_rata" || !indBalance) {
          if (qualified) return s + balance;
          return state
            ? s + state.contributionBasis + state.conversionBasis
            : s;
        }
        proRata.balance += balance;
        if (qualified) proRata.qualifiedBalance += balance;
        else if (state)
          proRata.basis += Math.min(
            balance,
            state.contributionBasis + state.conversionBasis,
          );
        return s;
      }, 0);
      if (indBalance) rothProRata = proRata;
    } else {
      rothBasisAvailable = Array.from(indBasis.values()).reduce(
        (s, state) => s + state.contributionBasis + state.conversionBasis,
        0,
      );
    }
  }
  const brokerageBasisRatio = Math.min(
    1,
    params.brokerageBasisRatio ??
      (balances.afterTax > 0 ? balances.afterTaxBasis / balances.afterTax : 0),
  );
  return { rothBasisAvailable, rothProRata, brokerageBasisRatio };
}

/** A `pro_rata` Roth's holdings: every draw is part basis, part growth. */
export type RothProRataHoldings = {
  balance: number;
  /** Contribution and conversion basis of the accounts whose owner isn't qualified. */
  basis: number;
  /** The balance of qualified owners' accounts, whose growth is tax-free too. */
  qualifiedBalance: number;
};

/** One stretch of the draw at one marginal cost per dollar withdrawn. */
export type DrawSegment = {
  source: WithdrawalSourceKind;
  part: DrawPart;
  amount: number;
  /** Tax per dollar withdrawn: ordinary, gains pushed up or taxed, NIIT, and
   *  the benefits the dollar makes taxable. */
  marginalCost: number;
  /** `marginalCost` includes the 3.8% NIIT. */
  includesNiit?: true;
};

const PART_SOURCE: Record<DrawPart, WithdrawalSourceKind> = {
  rothBasis: "roth",
  rothGrowth: "roth",
  rothProRata: "roth",
  brokerage: "brokerage",
  hsa: "hsa",
};
/** Equal costs: the free sources by the household's order, else Roth growth,
 *  the pro_rata Roth, brokerage, then HSA. */
const FREE_ORDER = {
  roth_first: ["rothBasis", "rothProRata", "brokerage", "rothGrowth", "hsa"],
  brokerage_first: [
    "brokerage",
    "rothBasis",
    "rothProRata",
    "rothGrowth",
    "hsa",
  ],
} satisfies Record<string, DrawPart[]>;
const PRICED: DrawPart[] = [
  "rothBasis",
  "rothGrowth",
  "rothProRata",
  "brokerage",
  "hsa",
];

const reachAt = (distance: number, rate: number) =>
  rate > 0 ? distance / rate : Infinity;

/** `part`'s cost for its next dollar at `at`, and how far it can be drawn
 *  before the cost changes. No filing status: brokerage at its gain share of
 *  the ordinary rate, unbounded (the walk draws it last). */
function priceAt(at: DrawState, part: DrawPart) {
  const inclusion = socialSecurityInclusionAt(at);
  const move = dollarMove(at, part, inclusion.rate);
  if (move.ordinary === 0 && move.gains === 0)
    return { cost: 0, includesNiit: false, reach: Infinity };
  const { filingStatus, ltcgBrackets, standardDeduction: deduction } = at;
  const { ordinaryIncome: o, gains: g, magi: m, taxMultiplier: k = 1 } = at;
  const ordinary = ordinaryCostAt(o, at);
  let reach = reachAt(gap(ordinary.top, o), move.ordinary);
  if (!filingStatus) {
    const cost = drawsGains(part)
      ? gainShareOf(at) * ordinary.rate
      : move.ordinary * ordinary.rate;
    if (drawsGains(part)) reach = Infinity;
    return { cost, includesNiit: false, reach };
  }
  const { ordinaryTaxable: taxable, unusedDeduction: unused } = ltcgStackBase(
    o,
    deduction,
  );
  const top = taxable + Math.max(0, g - unused);
  const topBracket = ltcgBracketAt(top, filingStatus, ltcgBrackets);
  const bottom = ltcgBracketAt(taxable, filingStatus, ltcgBrackets);
  const inDeduction = deduction !== undefined && cents(o) < cents(deduction);
  const gainsTaxed = cents(g) > cents(unused);
  const excess = m - niitThresholdFor(filingStatus);
  const niitOn = cents(excess) >= 0;
  const magiBinds = niitOn && cents(excess) < cents(g);
  const pushed = gainsTaxed
    ? k * (topBracket.rate - (inDeduction ? 0 : bottom.rate))
    : 0;
  const gainsRate = cents(g) >= cents(unused) ? k * topBracket.rate : 0;
  const niit = niitOn ? NIIT_RATE * (magiBinds ? move.magi : move.gains) : 0;
  // The gains' top rises with ordinary income and gains alike.
  const rise = move.ordinary + move.gains;
  if (inDeduction)
    reach = Math.min(reach, reachAt(gap(deduction, o), move.ordinary));
  if (cents(g) < cents(unused))
    reach = Math.min(reach, reachAt(gap(unused, g), rise));
  else reach = Math.min(reach, reachAt(gap(topBracket.top, top), rise));
  if (!inDeduction)
    reach = Math.min(reach, reachAt(gap(bottom.top, taxable), move.ordinary));
  if (!niitOn) reach = Math.min(reach, reachAt(-gap(excess, 0), move.magi));
  else if (magiBinds)
    reach = Math.min(reach, reachAt(gap(g, excess), move.magi - move.gains));
  reach = Math.min(reach, reachAt(inclusion.room, move.provisional));
  // Line 25: gains taxed as ordinary income when that costs less. `spread`
  // (cents) falls at `closing` per dollar until the two ways cross.
  const above = ordinaryCostAt(o + g, at);
  const asOrdinary = move.ordinary * (above.rate - ordinary.rate);
  const slopeAsOrdinary = asOrdinary + move.gains * above.rate;
  const stackedSlope = move.ordinary * pushed + move.gains * gainsRate;
  const both = gainsTaxBothWays(at, filingStatus);
  const spread = cents(both.stacked - both.asOrdinary);
  const capped = spread > 0 || (spread === 0 && slopeAsOrdinary < stackedSlope);
  const closing = capped
    ? slopeAsOrdinary - stackedSlope
    : stackedSlope - slopeAsOrdinary;
  reach = Math.min(reach, reachAt(Math.abs(spread) / 100, closing));
  if (capped) reach = Math.min(reach, reachAt(gap(above.top, o + g), rise));
  const cost = capped
    ? move.ordinary * ordinary.rate + slopeAsOrdinary + niit
    : move.ordinary * (ordinary.rate + pushed) + move.gains * gainsRate + niit;
  return { cost, includesNiit: niit > 0, reach };
}

/** Draws `need` from the source whose next dollar costs least, to the next cost
 *  change (an edge, the deduction, NIIT, a Social Security zone), a source's end
 *  or the need; with no reach left it stops. No filing status: brokerage last. */
export function walkDiscretionaryDraw(
  state: DrawState,
  sources: DrawSources,
  need: number,
): DrawSegment[] {
  const left = { ...sources };
  const at = { ...state };
  const freeOrder =
    FREE_ORDER[state.discretionaryWithdrawalOrder ?? "roth_first"];
  const segments: DrawSegment[] = [];
  let rest = need;
  for (let step = 0; cents(rest) > 0 && step <= 10_000; step++) {
    const open = PRICED.filter((p) => cents(left[p]) > 0);
    if (open.length === 0) break;
    const prices = new Map(open.map((p) => [p, priceAt(at, p)]));
    const priceOf = (p: DrawPart) => prices.get(p)!;
    const last = !state.filingStatus && open.length > 1;
    const rank = (p: DrawPart) =>
      last && drawsGains(p) ? Infinity : priceOf(p).cost;
    const part = open.reduce((best, p) => {
      const d = rank(p) - rank(best);
      if (Math.abs(d) > 1e-12) return d < 0 ? p : best;
      const order = priceOf(p).cost <= 1e-12 ? freeOrder : PRICED;
      return order.indexOf(p) < order.indexOf(best) ? p : best;
    });
    const { cost: marginalCost, includesNiit, reach } = priceOf(part);
    if (!(reach > 0)) break;
    const amount = Math.min(left[part], rest, reach);
    const prev = segments.at(-1);
    if (
      prev?.part === part &&
      prev.marginalCost === marginalCost &&
      !!prev.includesNiit === includesNiit
    )
      prev.amount += amount;
    else
      segments.push({
        source: PART_SOURCE[part],
        part,
        amount,
        marginalCost,
        ...(includesNiit && { includesNiit: true as const }),
      });
    left[part] -= amount;
    rest -= amount;
    advance(at, part, amount);
  }
  return segments;
}

/** Free capacity before any draw, so callers show room the year never reached:
 *  Roth basis (with an untaxed pro_rata Roth), and brokerage withdrawals whose gains
 *  fit in the unused deduction and the 0% bracket (0 without a filing status). */
export function freeDrawCapacities(
  state: DrawState,
  sources: DrawSources,
): { rothBasisCapacity: number; brokerageZeroLtcgCapacity: number } {
  const rothBasisCapacity =
    sources.rothBasis +
    (state.rothProRataTaxableShare > 0 ? 0 : sources.rothProRata);
  if (!state.filingStatus)
    return { rothBasisCapacity, brokerageZeroLtcgCapacity: 0 };
  const stack = ltcgStackBase(state.ordinaryIncome, state.standardDeduction);
  const taxable = stack.ordinaryTaxable;
  const zero = ltcgBracketAt(taxable, state.filingStatus, state.ltcgBrackets);
  const gains =
    stack.unusedDeduction + (zero.rate === 0 ? zero.top - taxable : 0);
  const share = gainShareOf(state);
  const withdrawal = share > 0 ? gains / share : Infinity;
  return {
    rothBasisCapacity,
    brokerageZeroLtcgCapacity: Math.max(
      0,
      Math.min(sources.brokerage, withdrawal),
    ),
  };
}

/** Draws `need` by marginal cost through `drawFrom` (draws up to a segment, returns
 *  what it drew). A source drawn short (an account or tax-type cap) is closed and
 *  the rest walked again from what was drawn. Returns each segment's draw. */
export function drawByMarginalCost(
  start: DrawState,
  sources: DrawSources,
  need: number,
  drawFrom: (segment: DrawSegment) => number,
): (DrawSegment & { drawn: number })[] {
  const at = { ...start };
  const left = { ...sources };
  const out: (DrawSegment & { drawn: number })[] = [];
  let rest = need;
  for (let pass = 0; pass < 4 && cents(rest) > 0; pass++) {
    let short = false;
    for (const segment of walkDiscretionaryDraw(at, left, rest)) {
      const drawn = drawFrom(segment);
      out.push({ ...segment, drawn });
      rest -= drawn;
      left[segment.part] -= drawn;
      advance(at, segment.part, drawn);
      short = cents(drawn) < cents(segment.amount) && cents(rest) > 0;
      if (short) {
        left[segment.part] = 0;
        break;
      }
    }
    if (!short) break;
  }
  return out;
}
