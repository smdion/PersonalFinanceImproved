/**
 * How a paycheck deduction is taxed, named the way a pay stub groups it.
 * Each preset is the pair of flags the calculator reads: `isPretax`
 * (reduces federal income-tax wages) and `ficaExempt` (reduces Social
 * Security + Medicare wages). Data, not code: another preset is one entry.
 */
export type DeductionPreset = {
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
