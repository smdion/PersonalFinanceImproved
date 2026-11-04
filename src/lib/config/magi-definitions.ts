// Modified adjusted gross income, one definition per rule that reads it.
// Every rule sums the same streams (`yearMagi`; no tax-exempt interest or
// excluded foreign income is modelled); they differ in the Social Security.

/** How much of the year's Social Security a MAGI counts. */
type SocialSecurityReading = "gross" | "taxable";

type MagiDefinition = { readonly socialSecurity: SocialSecurityReading };

export const MAGI_DEFINITIONS = {
  /** IRMAA (20 CFR § 418.1010). */
  irmaa: { socialSecurity: "taxable" },
  /** ACA (IRC § 36B(d)(2)(B)): adds back the nontaxable Social Security. */
  aca: { socialSecurity: "gross" },
  /** NIIT (IRC § 1411(d)). */
  niit: { socialSecurity: "taxable" },
} as const satisfies Record<string, MagiDefinition>;

export type MagiRule = keyof typeof MAGI_DEFINITIONS;
