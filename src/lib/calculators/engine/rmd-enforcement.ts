/**
 * RMD Enforcement — ensures minimum Traditional withdrawals per IRS rules.
 *
 * After withdrawal routing decides allocations, this module enforces the
 * Required Minimum Distribution. If Traditional withdrawals are below the
 * RMD floor, the shortfall is distributed proportionally across Traditional
 * accounts. Applies to ALL routing modes.
 */
import type {
  DecumulationSlot,
  AccountCategory,
  IndividualAccountInput,
} from "../types";
import { roundToCents } from "../../utils/math";
import type { AccountBalances } from "../types";
import {
  categoriesWithTaxPreference,
  isPreTaxType,
  isRetirementMoney,
} from "../../config/account-types";
import { getTraditionalBalance } from "../../config/account-balance";
import { computeRmdAmount } from "../../config/rmd-tables";
import { RMD_EXCISE_TAX_RATE } from "../../constants";
import type { NonRetirementExclusion } from "@/lib/pure/withdrawal-eligibility";
import type { IndKeyFn } from "@/lib/pure/accounts/account-part";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RmdEnforcementInput {
  age: number;
  rmdStartAge: number | null;
  priorYearEndTradBalance: number;
  slots: DecumulationSlot[];
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  acctBal: AccountBalances;
  /** When provided, overrides the internal RMD calculation. Tests only:
   *  multi-person households go through `enforceOwnerRmds`. */
  overrideRmdRequired?: number;
  /** Portfolio-parented ("non-retirement") exclusion for this year.
   *  The RMD REQUIREMENT itself (`rmdRequired`, derived from
   *  `priorYearEndTradBalance` upstream of this module) stays computed off
   *  the full blended balance — RMDs are a real IRS obligation on real
   *  dollars regardless of this app's internal parentCategory tagging, and
   *  that must NOT change. Only the shortfall's per-category DISTRIBUTION
   *  CAPACITY (`tradBalByCategory` below) is scoped: a Portfolio-parented
   *  account can't be forced to cover a Retirement-plan RMD shortfall. */
  nonRetirement?: NonRetirementExclusion;
}

interface RmdEnforcementResult {
  rmdAmount: number;
  rmdOverrodeRouting: boolean;
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  warnings: string[];
  /** Portion of `rmdAmount` that could NOT be forced through as a real
   *  taxable distribution (0 in the overwhelmingly common case) — real IRS
   *  exposure, not a display nicety: the same shortfall this function
   *  already prices into the `RMD SHORTFALL` warning string's 25% excise
   *  tax estimate, just also exposed as a number so the UI can show it
   *  without parsing a warning string. Possible now that the Portfolio-parented
   *  exclusion can leave
   *  Retirement-only Traditional capacity genuinely insufficient to cover
   *  a real RMD requirement. */
  rmdShortfallAmount: number;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Enforce IRS Required Minimum Distribution on Traditional withdrawals.
 *
 * Mutates `slots` in place (adds RMD shortfall to existing slots or creates
 * new ones). Returns updated totals and diagnostic info.
 */
/** What routing drew from Traditional money itself: the total's slots
 *  less any single-bucket (HSA) draw, which isn't Traditional for an RMD. */
function routedTraditionalDraw(slots: DecumulationSlot[]): number {
  const tradCategories = new Set<AccountCategory>(
    categoriesWithTaxPreference(),
  );
  return roundToCents(
    slots.reduce(
      (sum, s) =>
        tradCategories.has(s.category) ? sum + s.traditionalWithdrawal : sum,
      0,
    ),
  );
}

export function enforceRmd(input: RmdEnforcementInput): RmdEnforcementResult {
  const { age, rmdStartAge, priorYearEndTradBalance, slots, acctBal } = input;
  let { totalTraditionalWithdrawal, totalWithdrawal } = input;

  const warnings: string[] = [];
  let rmdAmount = 0;
  let rmdOverrodeRouting = false;
  let rmdShortfallAmount = 0;

  if (
    (input.overrideRmdRequired != null && input.overrideRmdRequired > 0) ||
    (rmdStartAge != null && age >= rmdStartAge && priorYearEndTradBalance > 0)
  ) {
    const computedRmd = computeRmdAmount(priorYearEndTradBalance, age);
    if (input.overrideRmdRequired != null || computedRmd != null) {
      const rmdRequired = input.overrideRmdRequired ?? computedRmd!;
      rmdAmount = rmdRequired;
      // Only Traditional money meets an RMD: an HSA draw also sits in the
      // total (single-bucket, pre-tax) but doesn't count toward it.
      const routedTraditional = routedTraditionalDraw(slots);
      if (routedTraditional < rmdRequired) {
        const rmdShortfall = roundToCents(rmdRequired - routedTraditional);
        rmdOverrodeRouting = true;
        // Distribute shortfall proportionally across roth_traditional accounts
        // based on their current Traditional balance.
        const tradCategories = categoriesWithTaxPreference();
        // Compute available capacity per category: balance minus what routing already took
        const tradBalByCategory = tradCategories.map((cat) => {
          const fullBal = getTraditionalBalance(acctBal[cat]);
          const alreadyRouted =
            slots.find((s) => s.category === cat)?.traditionalWithdrawal ?? 0;
          const nonRetirementAmount = input.nonRetirement?.trad[cat] ?? 0;
          return {
            cat,
            bal: Math.max(
              0,
              roundToCents(fullBal - nonRetirementAmount - alreadyRouted),
            ),
          };
        });
        const totalTradBal = tradBalByCategory.reduce((s, x) => s + x.bal, 0);
        let distributed = 0;
        if (totalTradBal > 0) {
          // Multi-pass distribution: proportional allocation with cap redistribution.
          const allocated = new Map<AccountCategory, number>();
          const capped = new Set<AccountCategory>();
          let remaining = rmdShortfall;

          while (remaining > 0.01) {
            const uncappedEntries = tradBalByCategory.filter(
              ({ cat, bal }) => bal > 0 && !capped.has(cat),
            );
            const uncappedBal = uncappedEntries.reduce((s, x) => s + x.bal, 0);
            if (uncappedBal <= 0) break;

            let passDistributed = 0;
            for (const { cat, bal } of uncappedEntries) {
              const share = roundToCents(remaining * (bal / uncappedBal));
              const prior = allocated.get(cat) ?? 0;
              const maxForCat = roundToCents(bal - prior);
              const actual = Math.min(share, Math.max(0, maxForCat));
              if (actual < share) capped.add(cat);
              allocated.set(cat, roundToCents(prior + actual));
              passDistributed += actual;
            }
            remaining = roundToCents(remaining - passDistributed);
            if (passDistributed < 0.01) break;
          }

          // Apply allocations to slots, assign rounding residual to last
          let lastSlot: DecumulationSlot | null = null;
          let lastCat: AccountCategory | null = null;
          for (const { cat } of tradBalByCategory) {
            const amount = allocated.get(cat) ?? 0;
            if (amount <= 0) continue;
            let slot = slots.find((s) => s.category === cat);
            if (slot) {
              slot.traditionalWithdrawal = roundToCents(
                slot.traditionalWithdrawal + amount,
              );
              slot.withdrawal = roundToCents(slot.withdrawal + amount);
            } else {
              slot = {
                category: cat,
                withdrawal: amount,
                traditionalWithdrawal: amount,
                rothWithdrawal: 0,
              } as DecumulationSlot;
              slots.push(slot);
            }
            distributed += amount;
            lastSlot = slot;
            lastCat = cat;
          }
          // Assign rounding residual to last category -- capped at that
          // category's own remaining capacity (`residual` here used
          // to always be rounding-cents-scale, since totalTradBal covered
          // the full blended balance and could always absorb the whole
          // shortfall; now that capacity can be genuinely, non-trivially
          // less than rmdShortfall (Retirement-only scoping), blindly
          // force-feeding the full residual into the last touched account
          // would silently exceed its capacity and defeat the cap this
          // function exists to enforce -- a real bug caught by a direct
          // repro during this session, not a hypothetical).
          const residual = roundToCents(rmdShortfall - distributed);
          if (residual > 0 && lastSlot && lastCat) {
            const lastCatCapacity =
              tradBalByCategory.find((x) => x.cat === lastCat)?.bal ?? 0;
            const lastCatAllocated = allocated.get(lastCat) ?? 0;
            const cappedResidual = Math.min(
              residual,
              Math.max(0, roundToCents(lastCatCapacity - lastCatAllocated)),
            );
            if (cappedResidual > 0) {
              lastSlot.traditionalWithdrawal = roundToCents(
                lastSlot.traditionalWithdrawal + cappedResidual,
              );
              lastSlot.withdrawal = roundToCents(
                lastSlot.withdrawal + cappedResidual,
              );
              distributed = roundToCents(distributed + cappedResidual);
            }
          }
        }
        totalTraditionalWithdrawal = roundToCents(
          totalTraditionalWithdrawal + distributed,
        );
        totalWithdrawal = roundToCents(totalWithdrawal + distributed);
        if (distributed < rmdShortfall - 0.01) {
          // What actually met the RMD: Traditional money only, not the HSA
          // draw counted in totalTraditionalWithdrawal.
          const met = roundToCents(routedTraditional + distributed);
          rmdShortfallAmount = roundToCents(rmdRequired - met);
          const penalty = roundToCents(
            rmdShortfallAmount * RMD_EXCISE_TAX_RATE,
          );
          warnings.push(
            `RMD SHORTFALL: $${rmdRequired.toFixed(0)} of Traditional distribution still required this year but only $${met.toFixed(0)} available. ` +
              `IRS penalty (25% excise tax) on the $${rmdShortfallAmount.toFixed(0)} shortfall would be ~$${penalty.toFixed(0)}. ` +
              `The rest of the balance is held outside the retirement plan, in accounts Ledgr doesn't draw for retirement — take it from there to meet the RMD.`,
          );
        }
      }
    }
  }

  return {
    rmdAmount,
    rmdOverrodeRouting,
    totalTraditionalWithdrawal,
    totalWithdrawal,
    warnings,
    rmdShortfallAmount,
  };
}

// ---------------------------------------------------------------------------
// Per-owner enforcement
// ---------------------------------------------------------------------------

/**
 * Whose RMD a Traditional account counts toward. IRAs can't be joint, so an
 * account with no owner is a data gap, not shared money: it counts as the
 * primary person's, never left out of the RMD base. One rule for the RMD
 * base (state.ts, helpers.ts) and the pins below.
 */
export function rmdOwnerOf(
  ia: Pick<IndividualAccountInput, "ownerPersonId">,
  primaryPersonId: number | null,
): number | null {
  return ia.ownerPersonId ?? primaryPersonId;
}

interface OwnerRmdInput {
  /** Each person with an RMD due: what's left of it after their own QCD. */
  owners: { personId: number; personName: string; required: number }[];
  primaryPersonId: number | null;
  slots: DecumulationSlot[];
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  acctBal: AccountBalances;
  indAccts: IndividualAccountInput[];
  indKey: IndKeyFn;
  indBal: Map<string, number>;
  nonRetirement?: NonRetirementExclusion;
}

interface OwnerRmdResult {
  /** Account key → the Traditional draw that account must make for its
   *  owner's RMD (`distributeWithdrawals` applies these first). */
  pins: Map<string, number>;
  rmdOverrodeRouting: boolean;
  totalTraditionalWithdrawal: number;
  totalWithdrawal: number;
  warnings: string[];
  rmdShortfallAmount: number;
  /** Each owner's part of the RMD their accounts couldn't pay. */
  shortfallByPerson: Map<number, number>;
  /** Traditional dollars moved between categories to fall on the right
   *  owner's accounts — no change in income. */
  rmdReassignedAmount: number;
}

/**
 * Each person's RMD comes out of that person's own Retirement-parented
 * Traditional accounts — never a spouse's. For every person:
 *
 *   ownerDraw + min(qcd, rmd) + shortfall = rmd
 *
 * Each owner's whole remaining RMD is pinned to their accounts by balance
 * (the IRS has each 401(k) meet its own RMD; by balance approximates that,
 * and routing's other draws aren't checked plan by plan). Slots are then
 * reshaped so each carries its pins plus a share of the rest of what
 * routing took, so household Traditional is max(routed, Σ pins): moving a
 * draw onto the right owner adds no income; only a real deficit adds money
 * and overrides routing. What an owner's accounts can't cover stays that
 * owner's shortfall — it never spills to a spouse. Since an RMD is a
 * fraction of the prior year's balance, that only happens when the money
 * is Portfolio-parented.
 *
 * Mutates `slots` in place.
 */
export function enforceOwnerRmds(input: OwnerRmdInput): OwnerRmdResult {
  const { owners, slots, acctBal, indAccts, indKey, indBal } = input;
  const tradCategories = categoriesWithTaxPreference();
  const catRoom = new Map<AccountCategory, number>(
    tradCategories.map((cat) => [
      cat,
      Math.max(
        0,
        roundToCents(
          getTraditionalBalance(acctBal[cat]) -
            (input.nonRetirement?.trad[cat] ?? 0),
        ),
      ),
    ]),
  );
  const pins = new Map<string, number>();
  const pinByCat = new Map<AccountCategory, number>();
  const shortfallByPerson = new Map<number, number>();
  const warnings: string[] = [];

  for (const { personId, personName, required } of owners) {
    if (required <= 0) continue;
    const accts = indAccts.filter(
      (ia) =>
        rmdOwnerOf(ia, input.primaryPersonId) === personId &&
        isPreTaxType(ia.taxType) &&
        isRetirementMoney(ia.parentCategory) &&
        tradCategories.includes(ia.category),
    );
    const room = (ia: IndividualAccountInput) =>
      Math.max(
        0,
        Math.min(
          roundToCents(
            (indBal.get(indKey(ia)) ?? 0) - (pins.get(indKey(ia)) ?? 0),
          ),
          catRoom.get(ia.category) ?? 0,
        ),
      );
    // By balance, capped: an account or category out of room passes its
    // share to the owner's others on the next pass.
    let remaining = required;
    while (remaining > 0.005) {
      const open = accts.filter((ia) => room(ia) > 0);
      const openTotal = open.reduce((sum, ia) => sum + room(ia), 0);
      if (openTotal <= 0) break;
      let passed = 0;
      for (const ia of open) {
        const share = roundToCents(remaining * (room(ia) / openTotal));
        const draw = Math.min(share > 0 ? share : remaining, room(ia));
        if (draw <= 0) continue;
        const k = indKey(ia);
        pins.set(k, roundToCents((pins.get(k) ?? 0) + draw));
        pinByCat.set(
          ia.category,
          roundToCents((pinByCat.get(ia.category) ?? 0) + draw),
        );
        catRoom.set(
          ia.category,
          roundToCents((catRoom.get(ia.category) ?? 0) - draw),
        );
        passed = roundToCents(passed + draw);
        if (roundToCents(remaining - passed) <= 0) break;
      }
      remaining = roundToCents(remaining - passed);
      if (passed <= 0) break;
    }
    if (remaining > 0.01) {
      shortfallByPerson.set(personId, remaining);
      const penalty = roundToCents(remaining * RMD_EXCISE_TAX_RATE);
      warnings.push(
        `RMD SHORTFALL: ${personName}'s accounts can pay $${(required - remaining).toFixed(0)} of the $${required.toFixed(0)} Traditional distribution required this year. ` +
          `IRS penalty (25% excise tax) on the $${remaining.toFixed(0)} shortfall would be ~$${penalty.toFixed(0)}. ` +
          `The rest of ${personName}'s balance is held outside the retirement plan, in accounts Ledgr doesn't draw for retirement — take it from there to meet the RMD.`,
      );
    }
  }

  // Reshape: each slot's Traditional = its pins + a share of the rest.
  // Only the Traditional-bearing categories are reshaped, so only they
  // count here — the total also holds any HSA draw, which stays put.
  const routed = routedTraditionalDraw(slots);
  const pinned = roundToCents(
    [...pinByCat.values()].reduce((a, b) => a + b, 0),
  );
  const rest = Math.max(0, roundToCents(routed - pinned));
  const above = tradCategories.map((cat) => {
    const slotTrad =
      slots.find((s) => s.category === cat)?.traditionalWithdrawal ?? 0;
    return {
      cat,
      slotTrad,
      pin: pinByCat.get(cat) ?? 0,
      over: Math.max(0, roundToCents(slotTrad - (pinByCat.get(cat) ?? 0))),
    };
  });
  const overTotal = above.reduce((sum, x) => sum + x.over, 0);
  let placed = 0;
  let last: { cat: AccountCategory } | null = null;
  const nextTrad = new Map<AccountCategory, number>();
  for (const { cat, pin, over } of above) {
    const share = overTotal > 0 ? roundToCents(rest * (over / overTotal)) : 0;
    nextTrad.set(cat, roundToCents(pin + share));
    placed = roundToCents(placed + share);
    if (over > 0) last = { cat };
  }
  if (last) {
    nextTrad.set(
      last.cat,
      roundToCents((nextTrad.get(last.cat) ?? 0) + (rest - placed)),
    );
  }
  let rmdReassignedAmount = 0;
  for (const { cat, slotTrad } of above) {
    const next = nextTrad.get(cat) ?? 0;
    const delta = roundToCents(next - slotTrad);
    if (delta === 0) continue;
    if (delta > 0)
      rmdReassignedAmount = roundToCents(rmdReassignedAmount + delta);
    const slot = slots.find((s) => s.category === cat);
    if (slot) {
      slot.traditionalWithdrawal = next;
      slot.withdrawal = roundToCents(slot.withdrawal + delta);
    } else {
      slots.push({
        category: cat,
        withdrawal: next,
        traditionalWithdrawal: next,
        rothWithdrawal: 0,
      } as DecumulationSlot);
    }
  }

  const deficit = Math.max(0, roundToCents(pinned - routed));
  const shortfalls = [...shortfallByPerson.values()];
  return {
    pins,
    rmdOverrodeRouting: deficit > 0,
    totalTraditionalWithdrawal: roundToCents(
      input.totalTraditionalWithdrawal + deficit,
    ),
    totalWithdrawal: roundToCents(input.totalWithdrawal + deficit),
    warnings,
    rmdShortfallAmount: roundToCents(shortfalls.reduce((a, b) => a + b, 0)),
    shortfallByPerson,
    rmdReassignedAmount: Math.max(
      0,
      roundToCents(rmdReassignedAmount - deficit),
    ),
  };
}
