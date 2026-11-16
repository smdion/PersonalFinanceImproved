// Age rules as Ledgr applies them: each is met in a plan year by the age
// reached by Dec 31. Tests of an age against a rule go through
// lib/pure/household/age.ts.

/** When a rule's age is measured: "dec31", whole years (`year - birthYear`);
 *  "dec31ByMonth", whole months from the birth month, for a half-year age. */
export type AgeMeasure = "dec31" | "dec31ByMonth";

export type AgeRule = { readonly age: number; readonly measuredOn: AgeMeasure };

export const AGE_RULES = {
  /** QCDs (IRC §408(d)(8)(B)(ii): 70½), from the year the owner reaches
   *  70½ (a QCD that year can come after the date); independent of the RMD
   *  start age, which SECURE 2.0 moved. */
  qcd: { age: 70.5, measuredOn: "dec31ByMonth" },
  /** Medicare (Social Security Act §226): IRMAA starts, ACA subsidies end. */
  medicare: { age: 65, measuredOn: "dec31" },
} as const satisfies Record<string, AgeRule>;

export type AgeRuleKey = keyof typeof AGE_RULES;
