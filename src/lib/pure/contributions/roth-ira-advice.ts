import type { RothIraView } from "@/lib/pure/contributions/roth-ira";
import { formatCurrency, formatList } from "@/lib/utils/format";

/**
 * The verdict as each person's contribution route, worded once: `action` one line (null when
 * nothing to do), `detail` the how or fallback, `whenAllowed` when the year's money is allowed.
 */
export function rothIraAdvice(
  view: RothIraView,
  whenAllowed: string,
): { summary: string; action: string | null; detail: string | null } | null {
  const j = view.judgement;
  if (!j) return null;
  const direct = view.routes.filter((r) => r.route === "direct");
  const backdoor = view.routes.filter((r) => r.route === "backdoor");
  const names = (rs: typeof direct) => formatList(rs.map((r) => r.name));
  const allowed = j.people
    .map((p) => `${p.name} ${formatCurrency(p.maxDirect, 0)}`)
    .join(", ");
  const whereToSwitch =
    'Set "Gets to the Roth" to Backdoor on each Roth IRA contribution (Paycheck, or the account\'s contributions).';
  const howBackdoor =
    "Backdoor: a non-deductible traditional IRA contribution, then converted to Roth.";
  // How far income sits from the phase-out — the reason in one phrase.
  const where =
    j.verdict === "backdoor"
      ? "income is over the Roth IRA limit"
      : j.distanceToStart > 0
        ? `income is within ${formatCurrency(j.distanceToStart, 0)} of the Roth IRA limit`
        : "income is inside the Roth IRA phase-out";

  if (j.verdict === "direct")
    return {
      summary: backdoor.length
        ? `Direct Roth IRA contributions are OK at this income; the backdoor ${names(backdoor)} use${backdoor.length === 1 ? "s" : ""} works too.`
        : "Direct Roth IRA contribution OK.",
      action: null,
      detail: null,
    };

  if (j.verdict === "backdoor") {
    if (direct.length)
      return {
        summary: `Over the limit — ${names(direct)} contribute${direct.length === 1 ? "s" : ""} directly: switch to the backdoor Roth.`,
        action: `Switch ${names(direct)} to the backdoor Roth — ${where}`,
        detail: `${whereToSwitch} Anything already put in directly this year can be recharacterized before the filing deadline. ${howBackdoor}`,
      };
    if (backdoor.length)
      return {
        summary:
          "Over the limit — the backdoor Roth you use is the right route.",
        action: null,
        detail: null,
      };
    return {
      summary: "Over the limit — use the backdoor Roth.",
      action: `Use the backdoor Roth — ${where}`,
      detail: `Contributions are allowed ${whenAllowed}. ${howBackdoor}`,
    };
  }

  // Too close to call.
  if (direct.length)
    return {
      summary: `Close to the limit and ${names(direct)} contribute${direct.length === 1 ? "s" : ""} directly — switching to the backdoor removes the risk.`,
      action: `Switch ${names(direct)} to the backdoor Roth — ${where}`,
      detail: `${whereToSwitch} Staying direct? Allowed today: ${allowed}; check once the year's income is final and recharacterize anything over. ${howBackdoor}`,
    };
  if (backdoor.length)
    return {
      summary:
        "Close to the limit — the backdoor you use works at any income; nothing to decide.",
      action: null,
      detail: null,
    };
  return {
    summary: `Too close to call — wait until the year's income is final (contributions are allowed ${whenAllowed}), or use the backdoor, which works at any income. Allowed directly at today's estimate: ${allowed}.`,
    action: `Use the backdoor Roth — ${where}`,
    detail: `Or wait until the year's income is final (contributions are allowed ${whenAllowed}); allowed directly today: ${allowed}. ${howBackdoor}`,
  };
}
