/**
 * Backdoor Roth and pro-rata recommendations — adapters over the Roth IRA
 * view judged once in lib/pure/roth-ira.ts (buildRothIraView). Only maps
 * fields and picks urgency from the dated windows in config; no rule is
 * judged here.
 */
import { ROTH_RECOMMENDATION_WINDOWS as W } from "@/lib/config/recommendations";
import type { RothIraView } from "@/lib/pure/roth-ira";
import type {
  Recommendation,
  RecommendationUrgency,
} from "@/lib/pure/recommendations";
import { formatCurrency } from "@/lib/utils/format";
import { ROTH_IRA_MFS_PHASEOUT } from "@/lib/config/tax-params";

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
  if (!view || !j || j.verdict === "direct") return [];
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
  const out: Recommendation[] = [
    {
      id: "rothIra",
      area: "moneyMoves",
      urgency: urgency(W.rothIra.nowFrom),
      title: `${taxYear} Roth IRA: direct or backdoor`,
      action:
        j.verdict === "backdoor"
          ? `Over the Roth IRA income limit — contribute through the backdoor (a non-deductible traditional IRA contribution, then convert it), ${deadline}`
          : `Too close to the income limit to be sure — decide once the year's income is final (contributions are allowed ${deadline}). Direct now: ${j.people
              .map((p) => `${p.name} ${formatCurrency(p.maxDirect, 0)}`)
              .join(", ")}`,
      context,
      impact: null,
      href: "/",
      source: "ledgr",
    },
  ];
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
      href: "/",
      source: "ledgr",
    });
  return out;
}
