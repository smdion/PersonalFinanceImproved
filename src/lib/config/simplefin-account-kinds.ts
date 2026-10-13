/**
 * Recognising what kind of account a SimpleFIN account is from its name,
 * to suggest which of the household's sub-accounts it is.
 *
 * Why sub-accounts: a tracked (performance) account is often several
 * sub-accounts — one per owner, tax treatment and kind (e.g. a joint
 * "IRA" holding each spouse's Roth, or a 401k's Roth + Traditional +
 * employer match + rollover; see DESIGN.md "Performance Accounts"), while
 * institutions report each of those as a separate account. Linking a
 * SimpleFIN account to the right sub-account keeps per-person and
 * per-tax-type numbers exact.
 *
 * Data, not code: generic words institutions use, never household names.
 * First match wins, so more specific patterns come first.
 */
import type { AccountCategory } from "./account-types.types";
import type { PortfolioTaxType } from "./enum-values";

export type SimplefinAccountKind = {
  pattern: RegExp;
  accountType: AccountCategory;
  /** Null when the name doesn't say (e.g. a plan with several tax buckets). */
  taxType: PortfolioTaxType | null;
  subType?: string;
};

const SIMPLEFIN_ACCOUNT_KINDS: readonly SimplefinAccountKind[] = [
  {
    pattern: /\broth\b.*\bira\b|\bira\b.*\broth\b/i,
    accountType: "ira",
    taxType: "taxFree",
  },
  {
    pattern: /\brollover\b.*\bira\b/i,
    accountType: "ira",
    taxType: "preTax",
    subType: "Rollover",
  },
  {
    pattern: /\b(traditional|sep|simple)\b.*\bira\b/i,
    accountType: "ira",
    taxType: "preTax",
  },
  { pattern: /\bira\b/i, accountType: "ira", taxType: null },
  {
    pattern: /\bhealth savings\b|\bhsa\b/i,
    accountType: "hsa",
    taxType: "hsa",
  },
  { pattern: /\b403\s*\(?b\)?/i, accountType: "403b", taxType: null },
  {
    pattern: /\b401\s*\(?k\)?|\b457\b|\bsavings plan\b|\bthrift\b/i,
    accountType: "401k",
    taxType: null,
  },
  {
    pattern: /\bbrokerage\b|\bindividual\b|\bjoint\b|\binvestment account\b/i,
    accountType: "brokerage",
    taxType: "afterTax",
  },
];

export function recogniseAccountKind(
  name: string,
): SimplefinAccountKind | null {
  return SIMPLEFIN_ACCOUNT_KINDS.find((k) => k.pattern.test(name)) ?? null;
}
