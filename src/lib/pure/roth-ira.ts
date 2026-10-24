/**
 * Roth IRA eligibility — judged once here; the Taxes page, the Income card's line and the
 * Backdoor Roth / pro-rata recommendations read the result.
 *
 * Roth IRA MAGI (Pub 590-A Worksheet 2-1) starts from AGI, removes Roth
 * conversion income and adds back a few exclusions. Ledgr's AGI estimate
 * never includes conversion income and doesn't model the traditional IRA
 * deduction, so the estimate IS the Roth IRA MAGI here — conversions are
 * left out of both sides (subtracting them would understate MAGI, the wrong
 * direction for this decision).
 *
 * The verdict is deliberately asymmetric: a wrong "direct is fine" costs a
 * 6% excise tax or a recharacterization, a wrong "use the backdoor" costs
 * paperwork. So "direct" needs a safety margin below the phase-out start —
 * by default the phase-out range's own width (data-derived), overridable by
 * a household setting. Every number comes from yearly reference data.
 */
import {
  getAllCategories,
  isHsaCategory,
  isIraCategory,
  isPayrollDeductibleCategory,
  isPreTaxType,
} from "@/lib/config/account-types";
import { irsLimitOrNull } from "@/lib/pure/contributions";
import { ageInYear } from "@/lib/utils/date";
import {
  PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT,
  ROTH_IRA_REDUCED_LIMIT_FLOOR,
  ROTH_IRA_REDUCED_LIMIT_ROUNDING,
  SPOUSAL_IRA_FILING_STATUSES,
  rothIraPhaseoutKeys,
} from "@/lib/config/tax-params";
import { roundToCents, sumBy } from "@/lib/utils/math";

export type RothIraVerdict = "direct" | "tooClose" | "backdoor";

export type RothIraPersonInput = {
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

export type RothIraPersonResult = {
  personId: number;
  name: string;
  /** Most this person can put into a Roth IRA directly at this MAGI (Pub 590-A Worksheet 2-2). */
  maxDirect: number;
};

export type RothIraResult = {
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
  // IRA money can't exceed compensation. Married filing jointly, a spouse
  // can use the couple's combined compensation less what the other spouse
  // puts in (IRC 219(c)) — so the higher earner goes first and the rest
  // shares what's left; together they never pass combined compensation.
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

/**
 * Pre-tax money in each person's IRAs (traditional / SEP / SIMPLE — every
 * pre-tax balance in an IRA-type account; 401(k)/403(b) are outside the
 * pool). A backdoor Roth conversion is taxed pro-rata over this balance as
 * of Dec 31, so any amount makes most of the conversion taxable. The
 * current balance stands in for Dec 31.
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
    if (!isIraCategory(a.accountType) || !isPreTaxType(a.taxType)) continue;
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
export type RothIraMagiParts = {
  /** Salary + bonus − pre-tax payroll money (the tax's AGI). */
  wageAgi: number;
  /** HSA money paid in outside payroll — above-the-line. */
  hsaOutsidePayroll: number;
  /** Taxable investment income for the year (estimate). */
  investmentIncome: number;
};

export function rothIraMagi(parts: RothIraMagiParts): number {
  return Math.round(
    parts.wageAgi - parts.hsaOutsidePayroll + parts.investmentIncome,
  );
}

export type RothIraView = {
  magi: number;
  parts: RothIraMagiParts;
  /** null when the year's phase-out rows are missing from the tax data. */
  judgement: RothIraResult | null;
  /** Each person's pre-tax IRA balance — the pro-rata blocker for a backdoor conversion. */
  proRata: {
    personId: number;
    name: string;
    amount: number;
    hasEmployerPlan: boolean;
  }[];
};

/**
 * The Roth IRA view from the paycheck summary (wages, limits, phase-out
 * rows) and the investment side (investment income, IRA balances). Every
 * reader — the Taxes page, the Income card's line and the recommendations — goes through
 * this, so the verdict is judged once.
 */
export function buildRothIraView(args: {
  rothIra: RothIraSummary;
  wageAgi: number;
  hsaOutsidePayroll: number;
  investmentIncome: number;
  preTaxIraByPerson: readonly { personId: number; amount: number }[];
  marginOverride: number | null;
}): RothIraView {
  const parts: RothIraMagiParts = {
    wageAgi: args.wageAgi,
    hsaOutsidePayroll: args.hsaOutsidePayroll,
    investmentIncome: args.investmentIncome,
  };
  const magi = rothIraMagi(parts);
  const preTax = new Map(
    args.preTaxIraByPerson.map((p) => [p.personId, p.amount]),
  );
  return {
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

export type RothIraSummary = {
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
  }[];
};

/** A workplace retirement plan (payroll-deducted, not an HSA) — where a
 *  pre-tax IRA balance could be rolled to clear the pro-rata pool. */
function isEmployerPlanType(accountType: string): boolean {
  return (
    isPayrollDeductibleCategory(accountType) && !isHsaCategory(accountType)
  );
}

/**
 * The year's Roth IRA inputs from reference data and each person's
 * earnings — phase-out rows for the filing status and IRA limits read
 * softly (a restore or demo schema can lack newer keys; the panel then
 * hides). No filing status (no one with a job) → null.
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
  }[];
}): RothIraSummary | null {
  const iraCategory = getAllCategories().find(isIraCategory);
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
    })),
  };
}

/** A backdoor Roth is the plan (verdict "backdoor") — while it is, money in
 *  a traditional IRA is in transit, not idle cash. */
export function backdoorPlanned(view: RothIraView | null): boolean {
  return view?.judgement?.verdict === "backdoor";
}
