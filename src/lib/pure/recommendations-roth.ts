/**
 * Backdoor Roth and pro-rata recommendations — adapters over the Roth IRA
 * view judged once in lib/pure/roth-ira.ts (buildRothIraView). Only maps
 * fields and picks urgency from the dated windows in config; no rule is
 * judged here.
 */
import { ROTH_RECOMMENDATION_WINDOWS as W } from "@/lib/config/recommendations";
import type {
  Recommendation,
  RecommendationUrgency,
} from "@/lib/pure/recommendations";
import { formatCurrency } from "@/lib/utils/format";
import { ROTH_IRA_MFS_PHASEOUT } from "@/lib/config/tax-params";
import { rothIraAdvice, type RothIraView } from "@/lib/pure/roth-ira";

/** Shown wherever the verdict is: the app has no married-filing-separately
 *  status, whose phase-out is far lower. Built when shown, so privacy mode
 *  masks its dollars. */
export function rothMfsNote(): string {
  return `Filing married-separately? Your phase-out is ${formatCurrency(ROTH_IRA_MFS_PHASEOUT.start, 0)}–${formatCurrency(ROTH_IRA_MFS_PHASEOUT.end, 0)} — this verdict doesn't apply.`;
}

export function recommendationsFromRothIra(
  view: RothIraView | null,
  /** The tax year the view is for. */
  taxYear: number,
  /** Today, YYYY-MM-DD. */
  today: string,
): Recommendation[] {
  const j = view?.judgement;
  if (!view || !j) return [];
  const usesBackdoor = view.routes.some((r) => r.route === "backdoor");
  if (j.verdict === "direct" && !usesBackdoor) return [];
  const thisYear = Number(today.slice(0, 4));
  const monthDay = today.slice(5);
  // A past year: only the contribution decision is left, until the filing
  // deadline the following spring. A future year: nothing pressing.
  const pastYear = taxYear < thisYear;
  if (pastYear && (taxYear < thisYear - 1 || monthDay > W.contributionDeadline))
    return [];
  const urgency = (nowFrom: string): RecommendationUrgency =>
    pastYear || (taxYear === thisYear && monthDay >= nowFrom) ? "now" : "soon";
  const deadline = pastYear
    ? `by the ${taxYear} filing deadline`
    : "until the tax-filing deadline";
  const range = `${formatCurrency(j.phaseOutStart, 0)}–${formatCurrency(j.phaseOutEnd, 0)}`;
  const context = `${taxYear} Roth IRA MAGI about ${formatCurrency(view.magi, 0)}; phase-out ${range}. ${rothMfsNote()}`;
  // What to do given how each person contributes (direct or backdoor) —
  // nothing when the route they use already fits this income.
  const advice = rothIraAdvice(view, deadline);
  const out: Recommendation[] = advice?.action
    ? [
        {
          id: "rothIra",
          area: "moneyMoves",
          urgency: urgency(W.rothIra.nowFrom),
          title: `${taxYear} Roth IRA: direct or backdoor`,
          action: advice.action,
          context,
          impact: null,
          focus: { topic: "rothIra" },
          source: "ledgr",
        },
      ]
    : [];
  // The pro-rata blocker is measured on Dec 31 of the conversion year —
  // only actionable while that date is ahead.
  if (pastYear) return out;
  for (const p of view.proRata)
    out.push({
      id: `proRata:${p.personId}`,
      area: "moneyMoves",
      urgency: urgency(W.proRata.nowFrom),
      title: `${p.name}: pre-tax IRA money blocks a clean backdoor`,
      action: p.hasEmployerPlan
        ? `Consider rolling ${formatCurrency(p.amount, 0)} of pre-tax IRA money into your workplace plan before Dec 31 (if it accepts roll-ins) — otherwise most of a backdoor Roth conversion is taxable`
        : `${formatCurrency(p.amount, 0)} of pre-tax IRA money makes most of a backdoor Roth conversion taxable (pro-rata) — weigh that before converting`,
      context:
        "Current balance shown; the Dec 31 balance of traditional, SEP and SIMPLE IRAs is what counts",
      impact: null,
      focus: { topic: "rothIra" },
      source: "ledgr",
    });
  return out;
}
