/**
 * Every yearly figure in `contribution_limits` Ledgr knows: its name, where
 * Settings → Reference Data shows it, how it's displayed, and how much it
 * may move from one year to the next (the tax-data file's CI check).
 *
 * Account-type limits (401k / IRA / HSA) come from ACCOUNT_TYPE_CONFIG's
 * `irsLimitKeys` — the account config owns them; this file only adds their
 * kind. Everything else is listed here. A key the tax-data file ships must
 * be here (tests/config/tax-data-file.test.ts); a key a household has that
 * isn't here shows as not used by Ledgr.
 */
import { ACCOUNT_TYPE_CONFIG } from "./account-types";

/** How a figure changes year to year — what the CI bounds check allows.
 *  `indexed`: inflation-adjusted dollars (−2%…+15% a year).
 *  `rate`: a tax rate set by law (unchanged unless an exception is cited).
 *  `statutory`: a fixed dollar amount or year set by law (unchanged unless
 *  an exception is cited). */
export type TaxLimitKind = "indexed" | "rate" | "statutory";
export type TaxLimitFormat = "currency" | "percent" | "year";

export type TaxLimitKey = {
  key: string;
  label: string;
  /** Settings card it appears in. Account-type keys use the account's
   *  display label (the card Settings builds from the account config). */
  group: string;
  kind: TaxLimitKind;
  format: TaxLimitFormat;
};

/** Settings card order after the account-type cards. */
export const TAX_LIMIT_GROUPS = [
  "Standard deduction",
  "Senior deduction (2025–2028)",
  "Social Security & Medicare",
  "Roth IRA eligibility",
  "HSA eligibility (HDHP)",
  "Withholding",
] as const;

/** Account-type limit roles: label and kind. */
const ACCOUNT_ROLES: Record<
  "base" | "catchup" | "superCatchup" | "totalAdditions" | "coverageVariant",
  { label: string; kind: TaxLimitKind }
> = {
  base: { label: "Annual limit", kind: "indexed" },
  catchup: { label: "Catch-up", kind: "indexed" },
  superCatchup: { label: "Super catch-up", kind: "indexed" },
  totalAdditions: {
    label: "Total additions (employee + employer)",
    kind: "indexed",
  },
  coverageVariant: { label: "Family", kind: "indexed" },
};

/** Account-type keys whose kind differs from their role's. */
const ACCOUNT_KIND_OVERRIDES: Record<string, TaxLimitKind> = {
  // HSA catch-up is a flat $1,000 in law (IRC 223(b)(3)(B)), not indexed.
  hsa_catchup_limit: "statutory",
};

/** Roles in the order Settings lists them. */
const ROLE_ORDER = [
  "base",
  "coverageVariant",
  "catchup",
  "superCatchup",
  "totalAdditions",
] as const;

function accountKeys(): TaxLimitKey[] {
  const out = new Map<string, TaxLimitKey>();
  for (const cfg of Object.values(ACCOUNT_TYPE_CONFIG)) {
    const keys: Partial<Record<keyof typeof ACCOUNT_ROLES, string>> | null =
      cfg.irsLimitKeys;
    if (!keys) continue;
    for (const role of ROLE_ORDER) {
      const key = keys[role];
      if (!key || out.has(key)) continue;
      const r = ACCOUNT_ROLES[role];
      const label =
        role === "base" && keys.coverageVariant
          ? "Self-only" // HSA: the base limit is self-only, family its variant
          : role === "catchup" && cfg.catchupAge
            ? `Catch-up (${cfg.catchupAge}+)`
            : role === "superCatchup" && cfg.superCatchupAgeRange
              ? `Super catch-up (${cfg.superCatchupAgeRange[0]}–${cfg.superCatchupAgeRange[1]})`
              : r.label;
      out.set(key, {
        key,
        label,
        group: cfg.displayLabel,
        kind: ACCOUNT_KIND_OVERRIDES[key] ?? r.kind,
        format: "currency",
      });
    }
  }
  return [...out.values()];
}

const OTHER_KEYS: TaxLimitKey[] = [
  // Standard deduction
  {
    key: "standard_deduction_mfj",
    label: "Married filing jointly",
    group: "Standard deduction",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "standard_deduction_single",
    label: "Single",
    group: "Standard deduction",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "standard_deduction_hoh",
    label: "Head of household",
    group: "Standard deduction",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "additional_std_deduction_65_married",
    label: "Age 65+ addition, married (per spouse)",
    group: "Standard deduction",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "additional_std_deduction_65_unmarried",
    label: "Age 65+ addition, single / head of household",
    group: "Standard deduction",
    kind: "indexed",
    format: "currency",
  },
  // Senior deduction (OBBBA §70103) — fixed amounts, not indexed
  {
    key: "obbba_senior_deduction_per_person",
    label: "Per person 65+",
    group: "Senior deduction (2025–2028)",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "obbba_senior_deduction_phaseout_start_mfj",
    label: "Phase-out starts, married filing jointly",
    group: "Senior deduction (2025–2028)",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "obbba_senior_deduction_phaseout_start_unmarried",
    label: "Phase-out starts, single / head of household",
    group: "Senior deduction (2025–2028)",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "obbba_senior_deduction_phaseout_rate",
    label: "Phase-out rate",
    group: "Senior deduction (2025–2028)",
    kind: "rate",
    format: "percent",
  },
  {
    key: "obbba_senior_deduction_sunset_year",
    label: "Last year available",
    group: "Senior deduction (2025–2028)",
    kind: "statutory",
    format: "year",
  },
  // Social Security & Medicare
  {
    key: "ss_wage_base",
    label: "Social Security wage base",
    group: "Social Security & Medicare",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "fica_ss_rate",
    label: "Social Security rate",
    group: "Social Security & Medicare",
    kind: "rate",
    format: "percent",
  },
  {
    key: "fica_medicare_rate",
    label: "Medicare rate",
    group: "Social Security & Medicare",
    kind: "rate",
    format: "percent",
  },
  {
    key: "fica_medicare_surtax_rate",
    label: "Additional Medicare rate",
    group: "Social Security & Medicare",
    kind: "rate",
    format: "percent",
  },
  {
    key: "fica_medicare_surtax_threshold",
    label: "Additional Medicare: employer withholds above",
    group: "Social Security & Medicare",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "fica_medicare_surtax_liability_mfj",
    label: "Additional Medicare: owed above, married filing jointly",
    group: "Social Security & Medicare",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "fica_medicare_surtax_liability_single",
    label: "Additional Medicare: owed above, single",
    group: "Social Security & Medicare",
    kind: "statutory",
    format: "currency",
  },
  {
    key: "fica_medicare_surtax_liability_hoh",
    label: "Additional Medicare: owed above, head of household",
    group: "Social Security & Medicare",
    kind: "statutory",
    format: "currency",
  },
  // Roth IRA eligibility (MAGI phase-out)
  {
    key: "roth_ira_phaseout_start_mfj",
    label: "Phase-out starts, married filing jointly",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "roth_ira_phaseout_end_mfj",
    label: "Phase-out ends, married filing jointly",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "roth_ira_phaseout_start_single",
    label: "Phase-out starts, single",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "roth_ira_phaseout_end_single",
    label: "Phase-out ends, single",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "roth_ira_phaseout_start_hoh",
    label: "Phase-out starts, head of household",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "roth_ira_phaseout_end_hoh",
    label: "Phase-out ends, head of household",
    group: "Roth IRA eligibility",
    kind: "indexed",
    format: "currency",
  },
  // HSA eligibility
  {
    key: "hdhp_min_deductible_self",
    label: "Minimum deductible, self-only",
    group: "HSA eligibility (HDHP)",
    kind: "indexed",
    format: "currency",
  },
  {
    key: "hdhp_min_deductible_family",
    label: "Minimum deductible, family",
    group: "HSA eligibility (HDHP)",
    kind: "indexed",
    format: "currency",
  },
  // Withholding
  {
    key: "supplemental_tax_rate",
    label: "Bonus (supplemental) withholding rate",
    group: "Withholding",
    kind: "rate",
    format: "percent",
  },
];

export const TAX_LIMIT_KEYS: readonly TaxLimitKey[] = [
  ...accountKeys(),
  ...OTHER_KEYS,
];

const BY_KEY = new Map(TAX_LIMIT_KEYS.map((k) => [k.key, k]));

/** The registry entry for a `limit_type`, or undefined for one Ledgr
 *  doesn't use (an old row a household still has). */
export function taxLimitKey(key: string): TaxLimitKey | undefined {
  return BY_KEY.get(key);
}

/** Settings cards: account-type cards first, then TAX_LIMIT_GROUPS. */
export function taxLimitGroups(): { label: string; keys: TaxLimitKey[] }[] {
  const groups = new Map<string, TaxLimitKey[]>();
  for (const k of TAX_LIMIT_KEYS) {
    if (!groups.has(k.group)) groups.set(k.group, []);
    groups.get(k.group)!.push(k);
  }
  return [...groups].map(([label, keys]) => ({ label, keys }));
}
