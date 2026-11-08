// ---------------------------------------------------------------------------
// Pure type definitions for account types
// ---------------------------------------------------------------------------

/** How an account type stores its balances. */
export type BalanceStructure =
  "roth_traditional" | "single_bucket" | "basis_tracking";

/** How withdrawals from this account type are taxed. */
type WithdrawalTaxType = "income" | "none" | "capital_gains";

/** Display grouping for paycheck/contribution views. */
export type DisplayGroup = "retirement" | "hsa" | "taxable";

// ---------------------------------------------------------------------------
// IRS limit key mapping
// ---------------------------------------------------------------------------

type IrsLimitKeys = {
  base: string;
  catchup: string;
  superCatchup?: string;
  coverageVariant?: string; // e.g. HSA family vs individual
  /** IRC 415(c) total-additions limit (employee + employer + after-tax) for
   *  employer plans — what's left is after-tax ("mega backdoor") room. */
  totalAdditions?: string;
};

// ---------------------------------------------------------------------------
// Color set
// ---------------------------------------------------------------------------

type ColorSet = {
  bg: string;
  bgLight: string;
  border: string;
  text: string;
};

// ---------------------------------------------------------------------------
// Account type config shape
// ---------------------------------------------------------------------------

/** Which early-access rule an account type's withdrawals follow. */
export type EarlyAccessRule =
  "ira_59_half" | "employer_plan" | "hsa_non_medical" | "none";

export type AccountTypeConfig = {
  // --- Identity ---
  displayLabel: string;
  description: string;
  keywords: readonly string[]; // for budget keyword matching

  // --- Tax behavior ---
  supportsRothSplit: boolean;
  balanceStructure: BalanceStructure;
  withdrawalTaxType: WithdrawalTaxType;
  taxBucketKey: string; // maps to byTaxType routing key
  supportedTaxTreatments: readonly string[];
  /** How IRS ordering rules treat a distribution from this account type's
   *  Roth (taxFree) balance: "basis_first" (a Roth IRA — contributions and
   *  seasoned conversions come out before growth, always) vs "pro_rata" (a
   *  designated Roth 401k/403b sub-election — any distribution is prorated
   *  between basis and earnings, IRS Notice 2009-68). null where the
   *  category has no Roth concept at all (hsa, brokerage). */
  rothOrderingRules: "basis_first" | "pro_rata" | null;
  /** The early-access rule a withdrawal follows: an IRA's 59½ and Roth
   *  ordering, an employer plan's 59½ or Rule of 55 (IRC §72(t)(2)(A)(v)),
   *  an HSA's age for non-medical use, or none. */
  earlyAccessRule: EarlyAccessRule;
  /** A Qualified Charitable Distribution can come from it (IRC 408(d)(8)). */
  qcdEligible: boolean;
  /** The penalty rate on an early non-medical withdrawal, in place of the
   *  10% early-withdrawal one (IRC 223(f)(4)); null where there is none. */
  nonMedicalPenaltyRate: number | null;
  /** Pre-tax in, tax-free growth and tax-free out for qualified expenses
   *  (IRC 223): the best treatment, so it's funded before any other
   *  tax-advantaged type. */
  tripleTaxAdvantaged: boolean;
  /** Its money is for qualified medical expenses (IRC 223(d)(2)): card spending
   *  through it is medical, and it keeps a cash buffer for those bills (by
   *  default the HDHP deductible). Set only where true. */
  paysMedicalExpenses?: true;
  /** Roth contributions phase out by income (IRC 408A(c)(3)), so the backdoor
   *  route runs through it: a Traditional contribution converted, taxed pro
   *  rata over its pre-tax balances (IRC 408(d)(2)). Set only where true. */
  rothIncomeLimited?: true;
  /** The household picks any fund in it (no plan's fixed menu), so a cheaper
   *  fund can replace a costly one. Set only where true. */
  fundChoiceOpen?: true;

  // --- IRS limits ---
  hasIrsLimit: boolean;
  irsLimitGroup: string | null; // shared limit group (401k/403b share)
  irsLimitKeys: IrsLimitKeys | null;
  matchCountsTowardLimit: boolean;
  /** Contributions can't exceed the person's taxable compensation (combined
   *  compensation for a spousal IRA, IRC 219(b)/(c)) — on top of the limit. */
  limitBoundedByCompensation: boolean;
  /** Whether this limit is per-household (counted once) vs per-person. */
  isHouseholdLimit: boolean;
  /** 5 when this account type is part of Money Guy's FOO step 5 (Roth IRA
   *  & HSA), else null. Step 6 (max out retirement) isn't a type property:
   *  it covers every account in the Retirement parent category. */
  fooStep: 5 | null;
  /** Age at which catchup contributions begin (null = no catchup). */
  catchupAge: number | null;
  /** Age range for super-catchup (SECURE 2.0), e.g. [60, 63]. null = no super-catchup. */
  superCatchupAgeRange: readonly [number, number] | null;

  // --- Prior-year contributions ---
  /** Whether contributions can be designated for the prior tax year (IRS window: Jan 1 – ~Apr 15). */
  supportsPriorYearContrib: boolean;

  // --- Routing ---
  isOverflowTarget: boolean;
  fixedContribScalesWithSalary: boolean;
  generateOverflowWarnings: boolean;
  defaultWithdrawalSplit: number;
  /** Position in the default withdrawal order (lowest drawn first). */
  decumulationRank: number;
  /** Whether contributions to this account type are deducted from the paycheck.
   *  true = employer-plan (401k, 403b, HSA) — deducted before take-home pay.
   *  false = individual account (IRA, brokerage) — paid from take-home pay. */
  isPayrollDeductible: boolean;
  /** Payroll contributions are made under a §125 cafeteria plan and so are
   *  not FICA wages (IRS Pub 15 / 15-B) — up to the IRS limit for the
   *  account type, after employer money. true for HSA only today. Applies
   *  only when the contribution is actually payroll-deducted. */
  payrollFicaExempt: boolean;

  // --- Classification ---
  parentCategory: "Retirement" | "Portfolio";
  displayGroup: DisplayGroup;
  participatesInEngine: boolean;
  engineParent: string | null; // sub-types roll up (ESPP → brokerage)

  // --- UI ---
  colors: ColorSet;
  /** Chart hex (Recharts/SVG): the standard and the lighter Roth shade. */
  chartHex: { standard: string; roth: string };
  employerMatchLabel: string;
  hasDiscountBar: boolean;
  /** Whether this account type's employer_contributions represents real cash
   *  ("match") or a non-cash purchase-price discount ("discount", e.g. ESPP).
   *  Drives the cash-basis (gainLoss + employerContributions) annotations —
   *  distinct from hasDiscountBar, which only controls progress-bar rendering. */
  employerContribKind: "match" | "discount";
  taxPreferenceNote: string;
  subTypeOptions: readonly string[];
  /** The sub-type (one of subTypeOptions) that holds employer match money,
   *  when the plan tracks it as its own part. Used to place estimated new
   *  contributions when a feed reports only the account's total. */
  employerMatchSubType?: string;

  // --- Sub-type display overrides ---
  // Sub-types (e.g. ESPP under brokerage) that need distinct display behavior.
  // Keyed by lowercase sub-type name. Not separate account categories — they
  // roll up to the parent in the engine and don't appear in getAllCategories().
  subTypeDisplay: Readonly<
    Record<
      string,
      {
        displayLabel: string;
        description: string;
        hasDiscountBar: boolean;
        employerMatchLabel: string;
        employerContribKind: "match" | "discount";
        colors: ColorSet;
      }
    >
  >;
};

export type AccountBalance =
  | { structure: "roth_traditional"; traditional: number; roth: number }
  | { structure: "single_bucket"; balance: number }
  | { structure: "basis_tracking"; balance: number; basis: number };

// ---------------------------------------------------------------------------
// UI segment type
// ---------------------------------------------------------------------------

/** `C` is `AccountCategory`, declared with the config in `account-types.ts`. */
export type AccountSegment<C extends string> = {
  key: string;
  category: C;
  label: string;
  subKey: string | null; // 'trad', 'roth', null
};
