// Age rules as Ledgr applies them today: every age is the age at Dec 31
// (`year - birthYear`). The statutory measures are v0.11 edits to one row
// each. Tests of an age against a rule go through lib/pure/household/age.ts.

/** When a rule's age is measured. Today: always the age at Dec 31. */
export type AgeMeasure = "dec31";

export type AgeRule = { readonly age: number; readonly measuredOn: AgeMeasure };

export const AGE_RULES = {
  /** QCDs (IRC §408(d)(8)(B)(ii): 70½), counted from the year of the 70th
   *  birthday; independent of the RMD start age, which SECURE 2.0 moved. */
  qcd: { age: 70, measuredOn: "dec31" },
  /** Medicare (Social Security Act §226): IRMAA starts, ACA subsidies end. */
  medicare: { age: 65, measuredOn: "dec31" },
} as const satisfies Record<string, AgeRule>;

export type AgeRuleKey = keyof typeof AGE_RULES;
