/**
 * How a paycheck deduction is taxed, named the way a pay stub groups it.
 * Each preset is the pair of flags the calculator reads: `isPretax`
 * (reduces federal income-tax wages) and `ficaExempt` (reduces Social
 * Security + Medicare wages). Data, not code: another preset is one entry.
 */
type DeductionPreset = {
  key: string;
  /** Short label for the pay-stub row. */
  short: string;
  /** Full label with examples, for forms. */
  label: string;
  isPretax: boolean;
  ficaExempt: boolean;
};

export const DEDUCTION_PRESETS: readonly DeductionPreset[] = [
  {
    key: "section125",
    short: "Before-tax (Section 125)",
    label:
      "Before-tax — health, dental, vision, payroll HSA (Section 125: no income tax or FICA)",
    isPretax: true,
    ficaExempt: true,
  },
  {
    key: "retirement",
    short: "Before-tax (retirement)",
    label:
      "Before-tax — retirement, e.g. traditional 401(k)/403(b) (no income tax; FICA still applies)",
    isPretax: true,
    ficaExempt: false,
  },
  {
    key: "afterTax",
    short: "After-tax",
    label:
      "After-tax — e.g. Roth 401(k), disability, life insurance, union dues (all taxes apply)",
    isPretax: false,
    ficaExempt: false,
  },
];

/** The preset a deduction's flags match (every valid pair has one). */
export function deductionPresetFor(flags: {
  isPretax: boolean;
  ficaExempt: boolean;
}): DeductionPreset {
  return (
    DEDUCTION_PRESETS.find(
      (p) => p.isPretax === flags.isPretax && p.ficaExempt === flags.ficaExempt,
    ) ?? DEDUCTION_PRESETS[DEDUCTION_PRESETS.length - 1]!
  );
}

/** How a line of other pay is taxed and paid, named the way a stub lists it. */
type EarningPreset = {
  key: string;
  short: string;
  label: string;
  isCash: boolean;
  federalTaxable: boolean;
  ficaTaxable: boolean;
};

export const EARNING_PRESETS: readonly EarningPreset[] = [
  {
    key: "paidTaxed",
    short: "Paid on the check",
    label:
      "Extra pay on every check — e.g. a stipend or allowance (paid and taxed)",
    isCash: true,
    federalTaxable: true,
    ficaTaxable: true,
  },
  {
    key: "imputed",
    short: "Taxable benefit (not paid)",
    label:
      "Taxable benefit, never paid — e.g. group life insurance over $50k, a company car (taxed, not take-home)",
    isCash: false,
    federalTaxable: true,
    ficaTaxable: true,
  },
];

/** The preset an earning's flags match, or null for a custom combination. */
export function earningPresetFor(flags: {
  isCash: boolean;
  federalTaxable: boolean;
  ficaTaxable: boolean;
}): EarningPreset | null {
  return (
    EARNING_PRESETS.find(
      (p) =>
        p.isCash === flags.isCash &&
        p.federalTaxable === flags.federalTaxable &&
        p.ficaTaxable === flags.ficaTaxable,
    ) ?? null
  );
}
