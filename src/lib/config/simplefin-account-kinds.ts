/** Name patterns suggesting which sub-account (owner, tax type, kind; DESIGN.md "Performance
 *  Accounts") a SimpleFIN account is. Generic institution words, never household names; first
 *  match wins, so more specific patterns come first. */
import type { AccountCategory } from "./account-types";
import type { PortfolioTaxType } from "./enum-values";

type SimplefinAccountKind = {
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
