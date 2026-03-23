/** Shared types for the contribution-accounts sub-components, including the ContribRow DB shape and PortfolioSub snapshot shape. */

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
