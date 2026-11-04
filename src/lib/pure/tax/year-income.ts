/**
 * One year's income, by stream, and the MAGI each rule reads from it
 * (`MAGI_DEFINITIONS`). The caller supplies the taxable share of Social
 * Security; MAGI is a reading of these streams, never a hand sum.
 */
import { MAGI_DEFINITIONS, type MagiRule } from "../../config/magi-definitions";

export type YearIncome = {
  readonly traditionalDraws: number;
  readonly rothConversions: number;
  /** Non-qualified Roth earnings: ordinary income. */
  readonly rothTaxableGrowth: number;
  /** The gains portion of brokerage sales. */
  readonly realizedGains: number;
  readonly socialSecurity: { readonly gross: number; readonly taxable: number };
};

type SocialSecurityFor<R extends MagiRule> =
  (typeof MAGI_DEFINITIONS)[R]["socialSecurity"];

/** The streams a rule's MAGI reads: Social Security only in its reading. */
export type MagiIncome<R extends MagiRule> = Omit<
  YearIncome,
  "socialSecurity"
> & {
  readonly socialSecurity: Pick<
    YearIncome["socialSecurity"],
    SocialSecurityFor<R>
  >;
};

/** The year's MAGI under `rule`. */
export function yearMagi<R extends MagiRule>(
  income: MagiIncome<R>,
  rule: R,
): number {
  const reading: SocialSecurityFor<R> = MAGI_DEFINITIONS[rule].socialSecurity;
  return (
    income.traditionalDraws +
    income.rothTaxableGrowth +
    income.rothConversions +
    income.realizedGains +
    income.socialSecurity[reading]
  );
}
