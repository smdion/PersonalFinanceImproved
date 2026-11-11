/**
 * Roth IRA eligibility, judged once for every reader. Ledgr's AGI estimate excludes conversions
 * so it is the Roth IRA MAGI (Pub 590-A). "Direct" needs a safety margin below the phase-out
 * start (default: the range's width), since a wrong "direct" costs a 6% excise tax.
 */
import { isRothIncomeLimited, isTaxFree } from "@/lib/config/account-types";
import type { RothIraRoute } from "@/lib/config/enum-values";
import type { RothIraSummary } from "@/lib/pure/contributions/roth-ira-summary";
import {
  judgeRothIra,
  type RothIraResult,
} from "@/lib/pure/contributions/roth-ira-judge";
import {
  PRO_RATA_MATERIAL_SHARE_OF_IRA_LIMIT,
  SPOUSAL_IRA_FILING_STATUSES,
} from "@/lib/config/tax-params";

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
