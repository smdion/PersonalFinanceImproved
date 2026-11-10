/**
 * Invented contribution_limits rows for the retired-limits shape
 * (stored-JSON tag, v0106-retired-limits.ts): the retired key goes in each
 * year; a key Ledgr reads and a household's own key stay.
 */
export const LIMITS = [
  { id: 901, tax_year: 2018, limit_type: "roth_ira_magi_limit_mfj" },
  { id: 902, tax_year: 2019, limit_type: "roth_ira_magi_limit_mfj" },
  { id: 903, tax_year: 2019, limit_type: "ss_wage_base" },
  { id: 904, tax_year: 2019, limit_type: "household_own_cap" },
].map((r) => ({ ...r, value: "1000", notes: null }));

/** Ids the converter deletes, and the ids it keeps. */
export const DELETED = [901, 902];
export const KEPT = [903, 904];
