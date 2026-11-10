/** The year's RMD step: each owner's QCD, then the RMD on the routed draw. */
import { roundToCents, sumBy } from "../../../utils/math";
import {
  isPreTaxType,
  isQcdEligible,
  isRetirementMoney,
} from "../../../config/account-types";
import { addTraditional } from "../../accounts/account-balance";
import { computeQcdAmounts, totalQcdAmount } from "../qcd";
import { reachesAgeRule } from "@/lib/pure/household/age";
import { enforceOwnerRmds, enforceRmd, rmdOwnerOf } from "../rmd-enforcement";
import { getRmdFactor } from "../../../config/rmd-tables";
import type { routeForMode } from "../withdrawal-routing";
import type { rmdIncomeByOwner } from "./decumulation-income";
import type { resolveDecumulationConfig } from "../override-resolution";
import type {
  PreYearSetup,
  ProjectionContext,
  ProjectionLoopState,
} from "./types";

/** Each owner's QCD this year, debited from that owner's own
 *  Retirement-parented IRAs and from the aggregate trackers. */
export function qcdStep(
  hasIndividualAccounts: boolean,
  rmdStartAgeByPerson: ProjectionContext["rmdStartAgeByPerson"],
  year: number,
  indAccounts: ProjectionContext["indAccounts"],
  ctx: ProjectionContext,
  indBalance: ProjectionLoopState["indBalance"],
  indKey: ProjectionContext["indKey"],
  decumulationDefaults: ProjectionContext["input"]["decumulationDefaults"],
  config: ReturnType<typeof resolveDecumulationConfig>,
  balances: ProjectionLoopState["balances"],
  accountBalance: ProjectionLoopState["accountBalance"],
) {
  // A QCD satisfies part of an owner's RMD tax-free, so it runs before the
  // tax estimate. Eligibility is the QCD age (AGE_RULES.qcd), not the RMD
  // start age, so it reads every tracked person, not only rmdByPerson.
  let totalQcd = 0;
  let qcdByPerson: { personId: number; qcdAmount: number }[] = [];
  const qcdEligiblePersonIds =
    hasIndividualAccounts && rmdStartAgeByPerson.size > 0
      ? Array.from(rmdStartAgeByPerson.entries())
          .filter(([, { birthYear }]) => reachesAgeRule(birthYear, "qcd", year))
          .map(([personId]) => personId)
      : [];
  if (qcdEligiblePersonIds.length > 0) {
    const iraTradByPerson = new Map<number, number>();
    for (const ia of indAccounts) {
      if (
        isQcdEligible(ia.category) &&
        rmdOwnerOf(ia, ctx.primaryPersonId) != null &&
        isPreTaxType(ia.taxType) &&
        // A Portfolio-parented IRA (nothing prevents one existing)
        // isn't retirement money -- must not inflate QCD-eligible capacity.
        isRetirementMoney(ia.parentCategory)
      ) {
        const balance = indBalance.get(indKey(ia)) ?? 0;
        const owner = rmdOwnerOf(ia, ctx.primaryPersonId)!;
        iraTradByPerson.set(owner, (iraTradByPerson.get(owner) ?? 0) + balance);
      }
    }
    // The per-person QCD limit is CPI-indexed (IRC 408(d)(8)(G)): grown
    // from the limits year like the standard deduction.
    const { qcdAnnualLimit, taxDataYear } =
      decumulationDefaults.distributionTaxRates;
    qcdByPerson = computeQcdAmounts(
      config.qcdMaximize,
      qcdEligiblePersonIds.map((personId) => ({
        personId,
        iraTraditionalBalance: iraTradByPerson.get(personId) ?? 0,
      })),
      qcdAnnualLimit * ctx.inflation.growthSinceVintage(year, taxDataYear),
    );
    totalQcd = totalQcdAmount(qcdByPerson);
    if (totalQcd > 0) {
      // Aggregate tracks (matches reinvestRmdExcess's own pattern -- both
      // trackers must still move together regardless of the per-account
      // debit below).
      balances.preTax = roundToCents(balances.preTax - totalQcd);
      addTraditional(accountBalance.ira, -totalQcd);
      // A QCD leaves one owner's own IRAs: debit each person's amount from
      // only their Retirement-parented IRAs, by balance, never pooled (the
      // reconcile step would spread it over every IRA in the category).
      for (const { personId, qcdAmount } of qcdByPerson) {
        if (qcdAmount <= 0) continue;
        const personIraAccounts = indAccounts.filter(
          (ia) =>
            isQcdEligible(ia.category) &&
            rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
            isPreTaxType(ia.taxType) &&
            isRetirementMoney(ia.parentCategory),
        );
        const personIraTotal = personIraAccounts.reduce(
          (s, ia) => s + Math.max(0, indBalance.get(indKey(ia)) ?? 0),
          0,
        );
        if (personIraTotal <= 0) continue;
        let distributed = 0;
        for (const ia of personIraAccounts) {
          const k = indKey(ia);
          const balance = Math.max(0, indBalance.get(k) ?? 0);
          const share = roundToCents(qcdAmount * (balance / personIraTotal));
          const capped = Math.min(share, balance);
          indBalance.set(k, roundToCents(balance - capped));
          distributed += capped;
        }
        // Rounding remainder mop-up, same convention as elsewhere in this
        // file (e.g. Roth conversion's tradAccounts loop).
        const remainder = roundToCents(qcdAmount - distributed);
        if (remainder > 0.005 && personIraAccounts.length > 0) {
          const first = personIraAccounts[0]!;
          const k = indKey(first);
          const balance = Math.max(0, indBalance.get(k) ?? 0);
          indBalance.set(k, roundToCents(Math.max(0, balance - remainder)));
        }
      }
    }
  }

  return { totalQcd, qcdByPerson };
}

/** The routed draw's totals with each RMD enforced on them. UD-04 (pending
 *  D1), today's behaviour: a short RMD adds Traditional on top of the routed
 *  draw; excess past the need is reinvested or spent (`rmdExcessHandling`). */
export function enforceYearRmd(
  slots: ReturnType<typeof routeForMode>["slots"],
  perOwnerRmd: boolean,
  rmdStartAge: ProjectionContext["rmdStartAge"],
  age: number,
  priorYearEndTradBalance: number,
  rmdByPerson: ReturnType<typeof rmdIncomeByOwner>["rmdByPerson"],
  qcdByPerson: ReturnType<typeof qcdStep>["qcdByPerson"],
  ctx: ProjectionContext,
  accountBalance: ProjectionLoopState["accountBalance"],
  indAccounts: ProjectionContext["indAccounts"],
  indKey: ProjectionContext["indKey"],
  indBalance: ProjectionLoopState["indBalance"],
  nonRetirement: PreYearSetup["nonRetirement"],
  routeWarnings: string[],
  state: ProjectionLoopState,
  perPersonRmdTotal: number | undefined,
) {
  let totalWithdrawal = roundToCents(sumBy(slots, (s) => s.withdrawal));
  const totalRothWithdrawal = roundToCents(
    sumBy(slots, (s) => s.rothWithdrawal),
  );
  let totalTraditionalWithdrawal = roundToCents(
    sumBy(slots, (s) => s.traditionalWithdrawal),
  );

  // Each owner's requirement is reduced by their own QCD only: the QCD'd
  // part already left the account tax-free, so only the rest is enforced.

  // The household path's divisor, shown as its RMD's working (the
  // per-owner rows carry their own).
  const rmdDivisor =
    !perOwnerRmd &&
    rmdStartAge != null &&
    age >= rmdStartAge &&
    priorYearEndTradBalance > 0
      ? (getRmdFactor(age) ?? undefined)
      : undefined;

  // Each RMD's minimum Traditional withdrawal, enforced (rmd-enforcement.ts).
  const ownerRmd = perOwnerRmd
    ? enforceOwnerRmds({
        owners: (rmdByPerson ?? []).map(({ personId, personName, amount }) => ({
          personId,
          personName,
          required: roundToCents(
            Math.max(
              0,
              amount -
                (qcdByPerson.find((q) => q.personId === personId)?.qcdAmount ??
                  0),
            ),
          ),
        })),
        primaryPersonId: ctx.primaryPersonId,
        slots,
        totalTraditionalWithdrawal,
        totalWithdrawal,
        accountBalance,
        indAccounts,
        indKey,
        indBalance,
        nonRetirement,
      })
    : null;
  const rmdResult =
    ownerRmd ??
    enforceRmd({
      age,
      rmdStartAge,
      priorYearEndTradBalance,
      slots,
      totalTraditionalWithdrawal,
      totalWithdrawal,
      accountBalance,
      nonRetirement,
    });
  const { rmdOverrodeRouting, rmdShortfallAmount } = rmdResult;
  totalTraditionalWithdrawal = rmdResult.totalTraditionalWithdrawal;
  totalWithdrawal = rmdResult.totalWithdrawal;
  routeWarnings.push(...rmdResult.warnings);
  if (ownerRmd && rmdByPerson) {
    for (const p of rmdByPerson) {
      const shortfall = ownerRmd.shortfallByPerson.get(p.personId);
      if (shortfall) p.shortfall = shortfall;
    }
    if (
      !state.rmdNoOwnerWarned &&
      rmdByPerson.some((p) => p.personId === ctx.primaryPersonId) &&
      indAccounts.some(
        (ia) => ia.ownerPersonId == null && isPreTaxType(ia.taxType),
      )
    ) {
      state.rmdNoOwnerWarned = true;
      routeWarnings.push(
        "A Traditional account has no owner — its RMD is counted with the primary person's. Give it an owner so the RMD falls on the right person.",
      );
    }
  }
  // The row's rmdAmount is the full requirement, not the QCD-reduced one
  // enforced: the QCD still satisfies it, without a taxable draw.
  const rmdAmount = ownerRmd
    ? (perPersonRmdTotal ?? 0)
    : "rmdAmount" in rmdResult
      ? rmdResult.rmdAmount
      : 0;

  return {
    totalWithdrawal,
    totalRothWithdrawal,
    totalTraditionalWithdrawal,
    rmdDivisor,
    ownerRmd,
    rmdOverrodeRouting,
    rmdShortfallAmount,
    rmdAmount,
  };
}
