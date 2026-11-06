/**
 * The year's RMD step: the QCD that satisfies part of each owner's RMD
 * before routing, and the RMD enforced on the routed draw after it.
 */
import { roundToCents } from "../../../utils/math";
import {
  isPreTaxType,
  isQcdEligible,
  isRetirementMoney,
} from "../../../config/account-types";
import { addTraditional } from "../../../config/account-balance";
import { computeQcdAmounts, totalQcdAmount } from "../qcd";
import { reachesAgeRule } from "@/lib/pure/household/age";
import { rmdOwnerOf } from "../rmd-enforcement";
import type { resolveDecumulationConfig } from "../override-resolution";
import type { ProjectionContext, ProjectionLoopState } from "./types";

/** Each owner's QCD this year, debited from that owner's own
 *  Retirement-parented IRAs and from the aggregate trackers. */
export function qcdStep(
  hasIndividualAccounts: boolean,
  rmdStartAgeByPerson: ProjectionContext["rmdStartAgeByPerson"],
  year: number,
  indAccts: ProjectionContext["indAccts"],
  ctx: ProjectionContext,
  indBal: ProjectionLoopState["indBal"],
  indKey: ProjectionContext["indKey"],
  decumulationDefaults: ProjectionContext["input"]["decumulationDefaults"],
  config: ReturnType<typeof resolveDecumulationConfig>,
  balances: ProjectionLoopState["balances"],
  acctBal: ProjectionLoopState["acctBal"],
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
    for (const ia of indAccts) {
      if (
        isQcdEligible(ia.category) &&
        rmdOwnerOf(ia, ctx.primaryPersonId) != null &&
        isPreTaxType(ia.taxType) &&
        // A Portfolio-parented IRA (nothing prevents one existing)
        // isn't retirement money -- must not inflate QCD-eligible capacity.
        isRetirementMoney(ia.parentCategory)
      ) {
        const bal = indBal.get(indKey(ia)) ?? 0;
        const owner = rmdOwnerOf(ia, ctx.primaryPersonId)!;
        iraTradByPerson.set(owner, (iraTradByPerson.get(owner) ?? 0) + bal);
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
      addTraditional(acctBal.ira, -totalQcd);
      // A QCD leaves one owner's own IRAs: debit each person's amount from
      // only their Retirement-parented IRAs, by balance, never pooled (the
      // reconcile step would spread it over every IRA in the category).
      for (const { personId, qcdAmount } of qcdByPerson) {
        if (qcdAmount <= 0) continue;
        const personIraAccts = indAccts.filter(
          (ia) =>
            isQcdEligible(ia.category) &&
            rmdOwnerOf(ia, ctx.primaryPersonId) === personId &&
            isPreTaxType(ia.taxType) &&
            isRetirementMoney(ia.parentCategory),
        );
        const personIraTotal = personIraAccts.reduce(
          (s, ia) => s + Math.max(0, indBal.get(indKey(ia)) ?? 0),
          0,
        );
        if (personIraTotal <= 0) continue;
        let distributed = 0;
        for (const ia of personIraAccts) {
          const k = indKey(ia);
          const bal = Math.max(0, indBal.get(k) ?? 0);
          const share = roundToCents(qcdAmount * (bal / personIraTotal));
          const capped = Math.min(share, bal);
          indBal.set(k, roundToCents(bal - capped));
          distributed += capped;
        }
        // Rounding remainder mop-up, same convention as elsewhere in this
        // file (e.g. Roth conversion's tradAccounts loop).
        const remainder = roundToCents(qcdAmount - distributed);
        if (remainder > 0.005 && personIraAccts.length > 0) {
          const first = personIraAccts[0]!;
          const k = indKey(first);
          const bal = Math.max(0, indBal.get(k) ?? 0);
          indBal.set(k, roundToCents(Math.max(0, bal - remainder)));
        }
      }
    }
  }

  return { totalQcd, qcdByPerson };
}
