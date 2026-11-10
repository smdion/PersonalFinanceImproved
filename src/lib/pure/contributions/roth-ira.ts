/**
 * Roth IRA eligibility, judged once for every reader. Ledgr's AGI estimate excludes conversions
 * so it is the Roth IRA MAGI (Pub 590-A). "Direct" needs a safety margin below the phase-out
 * start (default: the range's width), since a wrong "direct" costs a 6% excise tax.
 */
import {
  getAllCategories,
  hasEarlyAccessRule,
  isPreTaxType,
  isRothIncomeLimited,
  isTaxFree,
} from "@/lib/config/account-types";
import type { RothIraRoute } from "@/lib/config/enum-values";
import { irsLimitOrNull } from "@/lib/pure/contributions/irs-limits";
import { ageInYear } from "@/lib/utils/date";
import {
  PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT,
  ROTH_IRA_REDUCED_LIMIT_FLOOR,
  ROTH_IRA_REDUCED_LIMIT_ROUNDING,
  SPOUSAL_IRA_FILING_STATUSES,
  rothIraPhaseoutKeys,
} from "@/lib/config/tax-params";
import { roundToCents, sumBy } from "@/lib/utils/math";
import { formatCurrency, formatList } from "@/lib/utils/format";

type RothIraVerdict = "direct" | "tooClose" | "backdoor";

type RothIraPersonInput = {
  personId: number;
  name: string;
  /** Wages (salary + bonus) — taxable compensation for the IRA limit. */
  compensation: number;
  /** The person's IRA limit for the year (catch-up by age included). */
  iraLimit: number;
  /** The most this person can put into an IRA this year from the IRS-limit
   *  cap pass (limit, compensation, the spouse's IRA money — IRC 219(c));
   *  absent = sized here from compensation. */
  iraRoom?: number | null;
};

type RothIraPersonResult = {
  personId: number;
  name: string;
  /** Most this person can put into a Roth IRA directly at this MAGI (Pub 590-A Worksheet 2-2). */
  maxDirect: number;
};

type RothIraResult = {
  magi: number;
  phaseOutStart: number;
  phaseOutEnd: number;
  /** The safety margin below the phase-out start "direct" needs. */
  margin: number;
  /** phaseOutStart − magi (negative once inside or past the range). */
  distanceToStart: number;
  verdict: RothIraVerdict;
  people: RothIraPersonResult[];
};

/** Pub 590-A Worksheet 2-2: the reduced Roth IRA limit inside the
 *  phase-out. `base` is the smaller of the IRA limit and compensation —
 *  the worksheet reduces that, not the limit. */
export function rothIraAllowed(
  magi: number,
  phaseOut: { start: number; end: number },
  base: number,
): number {
  if (base <= 0) return 0;
  if (magi <= phaseOut.start) return base;
  if (magi >= phaseOut.end) return 0;
  const reduction =
    (base * (magi - phaseOut.start)) / (phaseOut.end - phaseOut.start);
  // Round UP to the next $10 (cents first, so float error can't add $10);
  // any amount above $0 and under $200 becomes $200.
  const step = ROTH_IRA_REDUCED_LIMIT_ROUNDING;
  const allowed = Math.ceil(roundToCents(base - reduction) / step) * step;
  return allowed > 0
    ? Math.min(base, Math.max(allowed, ROTH_IRA_REDUCED_LIMIT_FLOOR))
    : 0;
}

export function judgeRothIra(args: {
  magi: number;
  /** null when the tax data lacks the year's phase-out rows → no verdict. */
  phaseOut: { start: number; end: number } | null;
  /** Household setting; null = the phase-out range's width. */
  marginOverride: number | null;
  /** MFJ: a spouse's IRA can be funded from combined compensation (spousal IRA). */
  combinedCompensation: boolean;
  people: RothIraPersonInput[];
}): RothIraResult | null {
  const { magi, phaseOut } = args;
  if (!phaseOut || phaseOut.end <= phaseOut.start) return null;
  const margin = args.marginOverride ?? phaseOut.end - phaseOut.start;
  const verdict: RothIraVerdict =
    magi < phaseOut.start - margin
      ? "direct"
      : magi >= phaseOut.end
        ? "backdoor"
        : "tooClose";
  // IRA money can't exceed compensation; married filing jointly, a spouse may use the
  // couple's combined compensation less the other's (IRC 219(c)): higher earner first.
  const householdCompensation = sumBy(args.people, (p) =>
    Math.max(0, p.compensation),
  );
  const maxDirect = new Map<number, number>();
  let compensationLeft = householdCompensation;
  for (const p of [...args.people].sort(
    (a, b) => b.compensation - a.compensation,
  )) {
    const own = Math.max(0, p.compensation);
    const usable =
      p.iraRoom ?? (args.combinedCompensation ? compensationLeft : own);
    const allowed = rothIraAllowed(
      magi,
      phaseOut,
      Math.min(p.iraLimit, usable),
    );
    maxDirect.set(p.personId, allowed);
    compensationLeft = Math.max(0, compensationLeft - allowed);
  }
  return {
    magi,
    phaseOutStart: phaseOut.start,
    phaseOutEnd: phaseOut.end,
    margin,
    distanceToStart: phaseOut.start - magi,
    verdict,
    people: args.people.map((p) => ({
      personId: p.personId,
      name: p.name,
      maxDirect: maxDirect.get(p.personId)!,
    })),
  };
}

/** How far back a backdoor deposit waiting to be converted is looked for:
 *  past a monthly contribute-then-convert cycle, with room for a late one. */
export const PENDING_CONVERSION_WINDOW_DAYS = 45;

/**
 * A traditional IRA deposit awaiting Roth conversion: latest balance less the window's lowest,
 * read from balances (transactions arrive days later). After-tax only on a backdoor route.
 */
export function pendingConversion(
  balances: readonly { day: string; balance: number }[],
  today: string,
  windowStart: string,
): number {
  const recent = balances.filter((b) => b.day >= windowStart && b.day <= today);
  if (recent.length < 2) return 0;
  const latest = recent.at(-1)!.balance;
  const lowest = Math.min(...recent.map((b) => b.balance));
  return Math.max(0, Math.round((latest - lowest) * 100) / 100);
}

/**
 * Pre-tax money in each person's IRA-type accounts (not 401(k)/403(b)); a backdoor conversion
 * is taxed pro-rata over it as of Dec 31, for which the current balance stands in.
 */
export function preTaxIraByPerson(
  accounts: readonly {
    accountType: string;
    taxType: string;
    ownerPersonId: number | null;
    amount: number;
  }[],
): {
  byPerson: Map<number, number>;
  /** Pre-tax IRA money with no owner recorded — can't be placed, so named as missing. */
  unowned: number;
} {
  const byPerson = new Map<number, number>();
  let unowned = 0;
  for (const a of accounts) {
    if (!isRothIncomeLimited(a.accountType) || !isPreTaxType(a.taxType))
      continue;
    if (a.amount <= 0) continue;
    if (a.ownerPersonId === null) {
      unowned += a.amount;
      continue;
    }
    byPerson.set(
      a.ownerPersonId,
      (byPerson.get(a.ownerPersonId) ?? 0) + a.amount,
    );
  }
  return { byPerson, unowned };
}

/** What the Roth IRA MAGI is built from — shown beside the figure. */
type RothIraMagiParts = {
  /** The tax's AGI: salary + bonus − pre-tax payroll money − HSA money
   *  paid in outside payroll. */
  wageAgi: number;
  /** Taxable investment income for the year (estimate). */
  investmentIncome: number;
};

function rothIraMagi(parts: RothIraMagiParts): number {
  return Math.round(parts.wageAgi + parts.investmentIncome);
}

export type RothIraView = {
  /** The household's tax-return filing status the phase-out is read for. */
  filingStatus: string;
  magi: number;
  parts: RothIraMagiParts;
  /** null when the year's phase-out rows are missing from the tax data. */
  judgement: RothIraResult | null;
  /** How each person who contributes to a Roth IRA gets the money there
   *  (their Contribution Profile's route); people with no Roth IRA
   *  contribution aren't listed. */
  routes: { personId: number; name: string; route: RothIraRoute }[];
  /** A backdoor deposit sitting in a traditional IRA, waiting to be
   *  converted: after-tax, so left out of the pro-rata amount below. */
  pendingConversion: { personId: number; name: string; amount: number }[];
  /** Each person's pre-tax IRA balance — the pro-rata blocker for a backdoor conversion. */
  proRata: {
    personId: number;
    name: string;
    amount: number;
    hasEmployerPlan: boolean;
  }[];
};

/**
 * The Roth IRA view from the paycheck summary and the investment side; every reader goes
 * through it, so the verdict is judged once.
 */
export function buildRothIraView(args: {
  rothIra: RothIraSummary;
  wageAgi: number;
  investmentIncome: number;
  preTaxIraByPerson: readonly { personId: number; amount: number }[];
  /** Each person's traditional-IRA deposit waiting to be converted. */
  pendingConversionByPerson?: readonly { personId: number; amount: number }[];
  marginOverride: number | null;
}): RothIraView {
  const parts: RothIraMagiParts = {
    wageAgi: args.wageAgi,
    investmentIncome: args.investmentIncome,
  };
  const magi = rothIraMagi(parts);
  const rawPreTax = new Map(
    args.preTaxIraByPerson.map((p) => [p.personId, p.amount]),
  );
  // A pending backdoor deposit is after-tax (Form 8606 basis), outside the pro-rata
  // rule: backdoor people only, capped at a year's IRA contribution and the balance.
  const backdoorPeople = new Set(
    args.rothIra.people
      .filter((p) => p.rothRoute === "backdoor")
      .map((p) => p.personId),
  );
  const pendingOf = (personId: number) => {
    const person = args.rothIra.people.find((p) => p.personId === personId);
    const raw =
      args.pendingConversionByPerson?.find((p) => p.personId === personId)
        ?.amount ?? 0;
    if (!backdoorPeople.has(personId) || person?.iraLimit == null) return 0;
    return Math.min(raw, person.iraLimit, rawPreTax.get(personId) ?? 0);
  };
  const preTax = new Map(
    [...rawPreTax].map(([id, amount]) => [id, amount - pendingOf(id)]),
  );
  return {
    filingStatus: args.rothIra.filingStatus,
    magi,
    parts,
    judgement: judgeRothIra({
      magi,
      phaseOut: args.rothIra.phaseOut,
      marginOverride: args.marginOverride,
      combinedCompensation: (
        SPOUSAL_IRA_FILING_STATUSES as readonly string[]
      ).includes(args.rothIra.filingStatus),
      people: args.rothIra.people.flatMap((p) =>
        p.iraLimit === null
          ? []
          : [
              {
                personId: p.personId,
                name: p.name,
                compensation: p.compensation,
                iraLimit: p.iraLimit,
                iraRoom: p.iraRoom,
              },
            ],
      ),
    }),
    pendingConversion: args.rothIra.people.flatMap((p) => {
      const amount = pendingOf(p.personId);
      return amount > 0 ? [{ personId: p.personId, name: p.name, amount }] : [];
    }),
    routes: args.rothIra.people.flatMap((p) =>
      p.rothRoute
        ? [{ personId: p.personId, name: p.name, route: p.rothRoute }]
        : [],
    ),
    proRata: args.rothIra.people.flatMap((p) => {
      const amount = preTax.get(p.personId) ?? 0;
      // Only a balance that would make a real share of a conversion
      // taxable (leftover cents don't); unknown limit → no warning.
      const material =
        p.iraLimit !== null &&
        amount >= PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT * p.iraLimit;
      return material
        ? [
            {
              personId: p.personId,
              name: p.name,
              amount,
              hasEmployerPlan: p.hasEmployerPlan,
            },
          ]
        : [];
    }),
  };
}

type RothIraSummary = {
  filingStatus: string;
  /** null when the tax data lacks the year's phase-out rows. */
  phaseOut: { start: number; end: number } | null;
  people: {
    personId: number;
    name: string;
    /** Taxable compensation (≈ W-2 box 1): salary + bonus − pre-tax payroll money. */
    compensation: number;
    /** null when the year's IRA limit row is missing. */
    iraLimit: number | null;
    /** Has a workplace plan that could take a pre-tax IRA roll-in. */
    hasEmployerPlan: boolean;
    /** The cap pass's most this person can put into an IRA (null: no IRA
     *  contribution to size it from). */
    iraRoom: number | null;
    /** How their Roth IRA contribution gets there; null = none. */
    rothRoute: RothIraRoute | null;
  }[];
};

/** A workplace retirement plan (the employer-plan early-access rule) —
 *  where a pre-tax IRA balance could be rolled to clear the pro-rata pool. */
function isEmployerPlanType(accountType: string): boolean {
  return hasEarlyAccessRule(accountType, "employer_plan");
}

/**
 * The year's Roth IRA inputs from reference data and earnings, read softly (missing keys hide
 * the panel). No filing status (no one with a job) → null.
 */
export function rothIraSummary(args: {
  filingStatus: string | null;
  taxYear: number;
  limits: Record<string, number>;
  people: readonly {
    personId: number;
    name: string;
    birthYear: number;
    earnings: { gross: number; preTaxFederal: number } | null;
    /** Account types of the person's job-linked contribution accounts. */
    jobAccountTypes: readonly string[];
    /** The cap pass's most this person can put into an IRA (null: none). */
    iraRoom?: number | null;
    /** Their Roth IRA contribution's route (null/absent: none). */
    rothRoute?: RothIraRoute | null;
  }[];
}): RothIraSummary | null {
  const iraCategory = getAllCategories().find(isRothIncomeLimited);
  if (!args.filingStatus || !iraCategory) return null;
  const keys = rothIraPhaseoutKeys(args.filingStatus);
  const start = args.limits[keys.start];
  const end = args.limits[keys.end];
  return {
    filingStatus: args.filingStatus,
    phaseOut: start !== undefined && end !== undefined ? { start, end } : null,
    people: args.people.map((p) => ({
      personId: p.personId,
      name: p.name,
      compensation: p.earnings
        ? Math.max(0, p.earnings.gross - p.earnings.preTaxFederal)
        : 0,
      iraLimit: irsLimitOrNull(
        iraCategory,
        ageInYear(p.birthYear, args.taxYear),
        null,
        args.limits,
      ),
      hasEmployerPlan: p.jobAccountTypes.some(isEmployerPlanType),
      iraRoom: p.iraRoom ?? null,
      rothRoute: p.rothRoute ?? null,
    })),
  };
}

/** A contribution into a Roth IRA (an IRA account taking Roth money). */
export function isRothIraContribution(c: {
  accountType: string;
  taxTreatment: string;
}): boolean {
  return isRothIncomeLimited(c.accountType) && isTaxFree(c.taxTreatment);
}

/** A person's Roth IRA route from their effective contribution rows: the
 *  active Roth IRA contribution's route (absent = direct); null when they
 *  make none. */
export function rothIraRouteOf(
  rows: readonly {
    accountType: string;
    taxTreatment: string;
    rothRoute?: RothIraRoute;
  }[],
): RothIraRoute | null {
  const roth = rows.find(isRothIraContribution);
  return roth ? (roth.rothRoute ?? "direct") : null;
}

/** A backdoor Roth is the plan (verdict "backdoor", or someone's Roth IRA
 *  route) — while it is, money in a traditional IRA is in transit, not
 *  idle cash. */
export function backdoorPlanned(view: RothIraView | null): boolean {
  return (
    view?.judgement?.verdict === "backdoor" ||
    (view?.routes.some((r) => r.route === "backdoor") ?? false)
  );
}

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
