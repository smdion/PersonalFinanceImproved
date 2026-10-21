/**
 * "Check against your pay stub": one check's figures from a real stub
 * (any subset) against what Ledgr figures for the same check, with the
 * likely cause of each difference and where to fix it. Nothing is stored.
 *
 * Rules:
 * - Compare the stub with Ledgr's own federal taxable wages and FICA wages
 *   (never "taxable gross − gross").
 * - Social Security / Medicare wages: the stub's wage boxes when given;
 *   otherwise worked back from the tax (tax ÷ rate) with a rate-sized
 *   tolerance. Social Security is compared for the check's own period and
 *   skipped once the year's pay has passed the wage base; the Medicare
 *   back-solve is skipped once Additional Medicare withholding applies.
 * - Federal withholding: a band of a few dollars, and only once federal
 *   taxable wages match (withholding follows them).
 * - A gap explained by deductions: a subset-sum over the person's lines,
 *   capped at MAX_LINES; more than one combination is reported as such.
 */
import { formatCurrency } from "@/lib/utils/format";
import {
  PAYSTUB_MAX_LINES as MAX_LINES,
  PAYSTUB_TOLERANCE,
  PAYSTUB_WITHHOLDING_TOLERANCE as WITHHOLDING_TOLERANCE,
} from "@/lib/constants";
import { countPeriodsElapsed, isPreTax } from "@/lib/calculators/paycheck";
import type { PaycheckResult } from "@/lib/calculators/types";

/** What Ledgr figures for the check being compared. */
export type PaystubLedgrCheck = {
  gross: number;
  federalTaxableGross: number;
  /** This check's Social Security / Medicare wages (gross less Section 125
   *  and FICA-exempt payroll money). */
  ficaWages: number;
  federalWithholding: number;
  netPay: number;
  /** The year's pay has passed the Social Security wage base by this check. */
  ssStopped: boolean;
  /** Year-to-date Medicare wages are past the Additional Medicare
   *  withholding threshold by this check. */
  additionalMedicare: boolean;
  rates: { socialSecurity: number; medicare: number };
  /** The check's deduction lines: before federal tax or not, and exempt
   *  from Social Security/Medicare (Section 125) or not. */
  lines: readonly {
    name: string;
    amount: number;
    pretax: boolean;
    ficaExempt: boolean;
  }[];
  /** A taxable benefit (never paid) is already entered under Other pay. */
  hasNonCashEarnings: boolean;
};

/** The year's FICA figures from the tax data (paycheck.computeSummary). */
export type FicaRates = {
  socialSecurity: number;
  medicare: number;
  socialSecurityWageBase: number;
  medicareWithholdingThreshold: number;
};

export type PaystubFigures = Partial<{
  gross: number;
  federalTaxableWages: number;
  socialSecurityWages: number;
  medicareWages: number;
  socialSecurity: number;
  medicare: number;
  federalWithholding: number;
  netPay: number;
}>;

export type PaystubFindingKey =
  | "gross"
  | "federalTaxableWages"
  | "socialSecurityWages"
  | "medicareWages"
  | "federalWithholding"
  | "netPay";

export type PaystubFinding = {
  key: PaystubFindingKey;
  label: string;
  /** What the stub says (null when skipped for lack of a figure). */
  stub: number | null;
  ledgr: number;
  status: "match" | "off" | "skipped";
  /** Why it differs and where to fix it, or why it was skipped. */
  note?: string;
};

const LABELS: Record<PaystubFindingKey, string> = {
  gross: "Gross pay",
  federalTaxableWages: "Federal taxable wages",
  socialSecurityWages: "Social Security wages",
  medicareWages: "Medicare wages",
  federalWithholding: "Federal withholding",
  netPay: "Net pay",
};

/** Every combination of lines whose amounts add up to `target` (within a
 *  cent per line). Lines past MAX_LINES aren't considered. */
export function linesSummingTo<T extends { amount: number }>(
  lines: readonly T[],
  target: number,
): T[][] {
  const pool = lines.filter((l) => l.amount > 0).slice(0, MAX_LINES);
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const picked = pool.filter((_, i) => mask & (1 << i));
    const sum = picked.reduce((s, l) => s + l.amount, 0);
    if (Math.abs(sum - target) <= 0.01 * picked.length) out.push(picked);
  }
  return out;
}

const names = (ls: readonly { name: string }[]) =>
  ls.map((l) => l.name).join(" + ");

/** "X looks after-tax on your stub" — or the combinations that could. */
function linesNote(
  combos: { name: string }[][],
  looks: string,
): string | undefined {
  if (combos.length === 0) return undefined;
  if (combos.length === 1) {
    const one = combos[0]!;
    return `${names(one)} ${one.length === 1 ? "looks" : "look"} ${looks} on your stub — change it on the pay stub.`;
  }
  return `One of these looks ${looks} on your stub: ${combos
    .slice(0, 3)
    .map(names)
    .join("; or ")}${combos.length > 3 ? "; …" : ""}.`;
}

function compare(
  key: PaystubFindingKey,
  stub: number | undefined,
  ledgr: number,
  tolerance: number,
  explain: (diff: number) => string | undefined,
): PaystubFinding | null {
  if (stub === undefined) return null;
  const diff = stub - ledgr;
  if (Math.abs(diff) <= tolerance)
    return { key, label: LABELS[key], stub, ledgr, status: "match" };
  return {
    key,
    label: LABELS[key],
    stub,
    ledgr,
    status: "off",
    note: explain(diff),
  };
}

/** Wages from the stub: its wage box, else worked back from the tax. */
function stubWages(
  wages: number | undefined,
  tax: number | undefined,
  rate: number,
): { value: number; tolerance: number } | undefined {
  if (wages !== undefined)
    return { value: wages, tolerance: PAYSTUB_TOLERANCE };
  if (tax === undefined || rate <= 0) return undefined;
  // The tax is rounded to the cent, so the wages behind it are only known
  // to about half a cent ÷ rate.
  return {
    value: tax / rate,
    tolerance: PAYSTUB_TOLERANCE + 0.005 / rate,
  };
}

export function checkPaystub(
  ledgr: PaystubLedgrCheck,
  stub: PaystubFigures,
): { findings: PaystubFinding[]; allMatch: boolean } {
  const findings: PaystubFinding[] = [];
  const push = (f: PaystubFinding | null) => f && findings.push(f);

  push(
    compare("gross", stub.gross, ledgr.gross, PAYSTUB_TOLERANCE, (d) =>
      d > 0
        ? `Your stub pays ${formatCurrency(d)} more a check — pay Ledgr doesn't have (add it under Other pay) or a different salary.`
        : `Your stub pays ${formatCurrency(-d)} less a check — check the salary in your Salary Profile.`,
    ),
  );

  const taxable = compare(
    "federalTaxableWages",
    stub.federalTaxableWages,
    ledgr.federalTaxableGross,
    PAYSTUB_TOLERANCE,
    (d) => {
      // Lower on the stub: something Ledgr counts as after-tax comes out
      // before tax there — and the reverse.
      const fromLines =
        d < 0
          ? linesNote(
              linesSummingTo(
                ledgr.lines.filter((l) => !l.pretax),
                -d,
              ),
              "before-tax",
            )
          : linesNote(
              linesSummingTo(
                ledgr.lines.filter((l) => l.pretax),
                d,
              ),
              "after-tax",
            );
      if (fromLines) return fromLines;
      if (d > 0 && !ledgr.hasNonCashEarnings)
        return `A taxable benefit of ${formatCurrency(d)} a check (e.g. group life insurance over the tax-free amount)? Add it under Other pay as a taxable benefit.`;
      return "Not explained by your deduction lines — compare them with the stub's.";
    },
  );
  push(taxable);

  // Social Security / Medicare wages, against Ledgr's FICA wages.
  const ficaNote = (d: number) =>
    d < 0
      ? (linesNote(
          linesSummingTo(
            ledgr.lines.filter((l) => !l.ficaExempt),
            -d,
          ),
          "exempt from Social Security and Medicare (Section 125)",
        ) ??
        "Not explained by your deduction lines — compare them with the stub's.")
      : (linesNote(
          linesSummingTo(
            ledgr.lines.filter((l) => l.ficaExempt),
            d,
          ),
          "subject to Social Security and Medicare",
        ) ??
        "Not explained by your deduction lines — compare them with the stub's.");

  const ss = stubWages(
    stub.socialSecurityWages,
    stub.socialSecurity,
    ledgr.rates.socialSecurity,
  );
  if (ss) {
    if (ledgr.ssStopped)
      push({
        key: "socialSecurityWages",
        label: LABELS.socialSecurityWages,
        stub: ss.value,
        ledgr: ledgr.ficaWages,
        status: "skipped",
        note: "Social Security stops once the year's pay passes the wage base — not compared for this check.",
      });
    else
      push(
        compare(
          "socialSecurityWages",
          ss.value,
          ledgr.ficaWages,
          ss.tolerance,
          ficaNote,
        ),
      );
  }

  if (stub.medicareWages === undefined && ledgr.additionalMedicare) {
    if (stub.medicare !== undefined)
      push({
        key: "medicareWages",
        label: LABELS.medicareWages,
        stub: null,
        ledgr: ledgr.ficaWages,
        status: "skipped",
        note: "Additional Medicare is withheld on this check, so the wages can't be worked back from the tax — enter the stub's Medicare wages instead.",
      });
  } else {
    const med = stubWages(
      stub.medicareWages,
      stub.medicare,
      ledgr.rates.medicare,
    );
    if (med)
      push(
        compare(
          "medicareWages",
          med.value,
          ledgr.ficaWages,
          med.tolerance,
          ficaNote,
        ),
      );
  }

  if (stub.federalWithholding !== undefined) {
    // Withholding follows the taxable wages: compared only once they match.
    if (taxable?.status !== "match")
      push({
        key: "federalWithholding",
        label: LABELS.federalWithholding,
        stub: stub.federalWithholding,
        ledgr: ledgr.federalWithholding,
        status: "skipped",
        note: taxable
          ? "Fix the federal taxable wages first — withholding follows them."
          : "Enter the stub's federal taxable wages too — withholding follows them.",
      });
    else
      push(
        compare(
          "federalWithholding",
          stub.federalWithholding,
          ledgr.federalWithholding,
          WITHHOLDING_TOLERANCE,
          () =>
            "Wages match, withholding doesn't — check the W-4 in your Salary Profile: filing status, Step 2(c) (multiple jobs), extra withholding.",
        ),
      );
  }

  const othersOff = findings.some((f) => f.status === "off");
  push(
    compare("netPay", stub.netPay, ledgr.netPay, PAYSTUB_TOLERANCE, () =>
      othersOff
        ? "Follows from the differences above."
        : ledgr.additionalMedicare
          ? "Additional Medicare (0.9%) is withheld on this check; Ledgr's per-check net pay leaves it out (it's in the year's tax)."
          : "Something on the stub isn't in Ledgr — another deduction or pay line.",
    ),
  );

  return {
    findings,
    allMatch: findings.length > 0 && findings.every((f) => f.status !== "off"),
  };
}

/** Which check of `year` a pay date is (1-based), counted from the job's
 *  anchor payday — the same anchor the paycheck's year schedule is built
 *  from (its anchor payday, else its start date). The latest check so far
 *  when no date is given. */
export function paystubCheckNumber(
  payDate: Date | null,
  payPeriod: string,
  anchor: string | Date,
  periodsPerYear: number,
): number {
  const n = countPeriodsElapsed(
    payDate ?? new Date(),
    payPeriod,
    new Date(anchor),
  );
  return Math.min(Math.max(n, 1), periodsPerYear);
}

/** Ledgr's figures for check `n` of the year. Wages and withholding are the
 *  same on every regular check; Social Security and net pay are the
 *  check's own (the wage base stops Social Security partway through a
 *  high-pay year). */
export function ledgrCheckFor(
  paycheck: PaycheckResult,
  rates: FicaRates,
  n: number,
  lineName: (name: string) => string = (name) => name,
): PaystubLedgrCheck {
  const period = paycheck.yearSchedule[n - 1];
  // Medicare wages so far this year through this check, the bonus included
  // once paid.
  const medicareWagesYtd =
    n * paycheck.ficaWages +
    (paycheck.bonusPeriod !== null && paycheck.bonusPeriod <= n
      ? paycheck.bonusEstimate.bonusFicaWages
      : 0);
  return {
    gross: paycheck.gross,
    federalTaxableGross: paycheck.federalTaxableGross,
    ficaWages: paycheck.ficaWages,
    federalWithholding: paycheck.federalWithholding,
    netPay: period?.netPay ?? paycheck.netPay,
    // Short of a full check's Social Security: the wage base is reached
    // (the check that crosses it included — its wage box is capped too).
    ssStopped: period
      ? period.ficaSS < paycheck.ficaWages * rates.socialSecurity - 0.01
      : false,
    additionalMedicare: medicareWagesYtd > rates.medicareWithholdingThreshold,
    rates: { socialSecurity: rates.socialSecurity, medicare: rates.medicare },
    lines: [...paycheck.preTaxDeductions, ...paycheck.postTaxDeductions].map(
      (d) => ({
        name: lineName(d.name),
        amount: d.amount,
        pretax: isPreTax(d.taxTreatment),
        ficaExempt: d.ficaExempt,
      }),
    ),
    hasNonCashEarnings: paycheck.earnings.some(
      (e) => !e.isCash && e.federalTaxable,
    ),
  };
}
