// Shared types for integration sub-components.

export type Service = "ynab" | "actual";

export type ApiCategoryOption = {
  id: string;
  name: string;
  groupName: string;
  budgeted: number;
};

export type BudgetMatch = {
  budgetItemId: number;
  ledgrName: string;
  ledgrCategory: string;
  ledgrAmount: number;
  status: "linked" | "suggested" | "unmatched";
  apiCategoryId: string | null;
  apiCategoryName: string | null;
  apiGroupName: string | null;
  apiBudgeted: number | null;
  apiActivity: number | null;
  syncDirection: "pull" | "push" | "both" | null;
  nameDrifted?: boolean;
  categoryDrifted?: boolean;
  contributionAccountId: number | null;
};

export type SavingsMatch = {
  goalId: number;
  goalName: string;
  status: "linked" | "suggested" | "unmatched";
  apiCategoryId: string | null;
  apiCategoryName: string | null;
  apiBalance: number | null;
  nameDrifted?: boolean;
  isEmergencyFund: boolean;
  reimbursementApiCategoryId: string | null;
};

export type PreviewData = {
  synced: true;
  fetchedAt: string;
  lastSyncedAt: string | null;
  cash: {
    manual: number;
    api: number;
    apiAccounts: { name: string; balance: number; type: string }[];
  };
  accounts: {
    total: number;
    onBudget: number;
    tracking: number;
    byType: Record<string, { count: number; balance: number }>;
  };
  categories: { groups: number; total: number };
  apiCategories?: ApiCategoryOption[];
  budget?: {
    matches: BudgetMatch[];
    unmatchedApiCategories: {
      id: string;
      name: string;
      groupName: string;
      budgeted: number;
    }[];
    skippedApiCategories?: {
      id: string;
      name: string;
      groupName: string;
      budgeted: number;
    }[];
    summary: {
      linked: number;
      suggested: number;
      unmatched: number;
      apiOnly: number;
    };
  };
  savings?: {
    matches: SavingsMatch[];
    summary: { linked: number; suggested: number; unmatched: number };
  };
  profile?: {
    linkedProfileId: number | null;
    linkedProfileName: string | null;
    linkedColumnIndex: number;
    columnLabels: string[];
    availableProfiles: {
      id: number;
      name: string;
      isActive: boolean;
      columnLabels: string[];
    }[];
  };
  portfolio?: {
    snapshotDate: string | null;
    localAccounts: {
      label: string;
      balance: number;
      performanceAccountId: number | null;
    }[];
    assetAccounts: { label: string; balance: number; id: number }[];
    mortgageAccounts: {
      label: string;
      id: number;
      type: "propertyValue" | "loanBalance";
      value: number;
    }[];
    trackingAccounts: {
      id: string;
      name: string;
      balance: number;
      type: string;
    }[];
    existingMappings: {
      localId?: string;
      localName: string;
      remoteAccountId: string;
      syncDirection: "pull" | "push" | "both";
    }[];
  };
};

export const STATUS_STYLES = {
  linked: { bg: "bg-green-50", text: "text-green-700", label: "Linked" },
  suggested: {
    bg: "bg-yellow-50",
    text: "text-yellow-700",
    label: "Suggested",
  },
  unmatched: {
    bg: "bg-surface-elevated",
    text: "text-faint",
    label: "No match",
  },
} as const;
