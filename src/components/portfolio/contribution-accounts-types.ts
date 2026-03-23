// Shared types for contribution-accounts sub-components.

export type ContribRow = typeof import("@/lib/db/schema").contributionAccounts.$inferSelect;

export type PortfolioSub = {
  id: number;
  taxType: string;
  subType: string | null;
  label: string | null;
  amount: string;
  accountType: string;
  ownerPersonId: number | null;
  isActive: boolean;
};
