// ---------------------------------------------------------------------------
// Pure type definitions for account types
// ---------------------------------------------------------------------------

/** How an account type stores its balances. */
export type BalanceStructure =
  | "roth_traditional"
  | "single_bucket"
  | "basis_tracking";

/** How withdrawals from this account type are taxed. */
export type WithdrawalTaxType = "income" | "none" | "capital_gains";

/** Display grouping for paycheck/contribution views. */
export type DisplayGroup = "retirement" | "hsa" | "taxable";

// ---------------------------------------------------------------------------
// IRS limit key mapping
// ---------------------------------------------------------------------------

export type IrsLimitKeys = {
  base: string;
  catchup: string;
  superCatchup?: string;
  coverageVariant?: string; // e.g. HSA family vs individual
};

// ---------------------------------------------------------------------------
// Color set
// ---------------------------------------------------------------------------

export type ColorSet = {
  bg: string;
  bgLight: string;
  border: string;
  text: string;
};

// ---------------------------------------------------------------------------
// Account type config shape
// ---------------------------------------------------------------------------

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

  // --- IRS limits ---
  hasIrsLimit: boolean;
  irsLimitGroup: string | null; // shared limit group (401k/403b share)
  irsLimitKeys: IrsLimitKeys | null;
  matchCountsTowardLimit: boolean;
  /** Whether this limit is per-household (counted once) vs per-person. */
  isHouseholdLimit: boolean;
  /** Age at which catchup contributions begin (null = no catchup). */
  catchupAge: number | null;
  /** Age range for super-catchup (SECURE 2.0), e.g. [60, 63]. null = no super-catchup. */
  superCatchupAgeRange: readonly [number, number] | null;

  // --- Routing ---
  isOverflowTarget: boolean;
  fixedContribScalesWithSalary: boolean;
  generateOverflowWarnings: boolean;
  defaultWithdrawalSplit: number;
  /** Whether contributions to this account type are deducted from the paycheck.
   *  true = employer-plan (401k, 403b, HSA) — deducted before take-home pay.
   *  false = individual account (IRA, brokerage) — paid from take-home pay. */
  isPayrollDeductible: boolean;

  // --- Classification ---
  parentCategory: "Retirement" | "Portfolio";
  displayGroup: DisplayGroup;
  participatesInEngine: boolean;
  engineParent: string | null; // sub-types roll up (ESPP → brokerage)

  // --- UI ---
  colors: ColorSet;
  employerMatchLabel: string;
  hasDiscountBar: boolean;
  taxPreferenceNote: string;
  subTypeOptions: readonly string[];

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
        colors: ColorSet;
      }
    >
  >;
};

// ---------------------------------------------------------------------------
// Balance discriminated union types
// ---------------------------------------------------------------------------

export type RothTraditionalBalance = { traditional: number; roth: number };
export type SingleBucketBalance = number;
export type BasisTrackingBalance = { balance: number; basis: number };

export type AccountBalance =
  | { structure: "roth_traditional"; traditional: number; roth: number }
  | { structure: "single_bucket"; balance: number }
  | { structure: "basis_tracking"; balance: number; basis: number };

// ---------------------------------------------------------------------------
// UI segment type
// ---------------------------------------------------------------------------

export type AccountSegment = {
  key: string;
  category: AccountCategory;
  label: string;
  subKey: string | null; // 'trad', 'roth', null
};

// ---------------------------------------------------------------------------
// Derived category type — needs the config object, so we use a generic
// constraint that will be satisfied by the main module's re-export.
// We define it here as a string literal union matching the known keys.
// ---------------------------------------------------------------------------

// NOTE: AccountCategory is derived from ACCOUNT_TYPE_CONFIG keys in the main
// module. We re-declare it here as the known union so pure-type consumers
// don't need to import runtime data.
export type AccountCategory = "401k" | "403b" | "ira" | "hsa" | "brokerage";

// ---------------------------------------------------------------------------
// Zod-compatible enum helpers (type-level only — runtime values live in main)
// ---------------------------------------------------------------------------

export const ACCOUNT_CATEGORY_VALUES: [AccountCategory, ...AccountCategory[]] =
  ["401k", "403b", "ira", "hsa", "brokerage"];

/** Zod-compatible tuple for z.enum() — import { accountCategoryEnum } and use z.enum(accountCategoryEnum()) */
export function accountCategoryEnum(): [AccountCategory, ...AccountCategory[]] {
  return ACCOUNT_CATEGORY_VALUES;
}
