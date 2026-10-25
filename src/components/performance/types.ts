import React from "react";
import type { PerfCategory } from "@/lib/config/display-labels";
import type { PerfCheck } from "@/lib/pure/performance-checks";
import type {
  AcceptedChecks,
  PerfField,
} from "@/lib/pure/performance-annotations";

export type EditingCell = {
  type: "annual" | "account" | "master" | "basis";
  id: number;
  field: string;
} | null;

export type AnnualRow = {
  id: number;
  year: number;
  category: PerfCategory;
  beginningBalance: number;
  totalContributions: number;
  yearlyGainLoss: number;
  endingBalance: number;
  annualReturnPct: number | null;
  employerContributions: number;
  distributions: number;
  fees: number;
  rollovers: number;
  lifetimeGains: number;
  lifetimeContributions: number;
  lifetimeMatch: number;
  isCurrentYear: boolean;
  isFinalized: boolean;
};

export type AccountRow = {
  id: number;
  institution: string;
  accountLabel: string;
  ownerName: string | null;
  ownerPersonId: number | null;
  ownershipType: string;
  beginningBalance: number;
  totalContributions: number;
  yearlyGainLoss: number;
  endingBalance: number;
  annualReturnPct: number | null;
  employerContributions: number;
  fees: number;
  distributions: number;
  rollovers: number;
  parentCategory: string;
  accountType: string | null;
  subType: string | null;
  isActive: boolean;
  performanceAccountId: number | null;
  displayOrder: number;
  year: number;
  /** Roth basis (account_basis, exact-year match) — null when the category
   *  doesn't track Roth basis (HSA/brokerage) or no row exists for this
   *  year yet. See tracksRothBasis() in lib/config/account-types.ts. */
  contributionBasis: number | null;
  conversionBasis: number | null;
  latestConversionYear: number | null;
  /** Each person's Roth basis for this account and year (a joint-labeled
   *  account can hold two people's Roth); the fields above are the total. */
  basisByOwner?: {
    ownerPersonId: number;
    ownerName: string | null;
    contributionBasis: number;
    conversionBasis: number;
    latestConversionYear: number | null;
    /** False when no basis row exists yet for this person and year. */
    recorded?: boolean;
  }[];
  /** Reconciliation checks (lib/pure/performance-checks.ts). */
  checks?: PerfCheck[];
  /** The household's note, still-estimated figures, accepted gaps. */
  note?: string | null;
  estimatedFields?: PerfField[];
  acceptedChecks?: AcceptedChecks;
};

export type MasterAccount = {
  id: number;
  institution: string;
  accountLabel: string;
  ownerName: string | null;
  ownerPersonId: number | null;
  ownershipType: string;
  parentCategory: string;
  accountType: string;
  isActive: boolean;
  displayOrder: number;
  costBasis?: string;
};

export type CreateAccountData = {
  year: number;
  performanceAccountId: number;
  beginningBalance: string;
  totalContributions: string;
  yearlyGainLoss: string;
  endingBalance: string;
  employerContributions: string;
  fees: string;
  distributions: string;
  rollovers: string;
};

export type EditableCellProps = {
  value: number;
  formatter: (v: number) => string;
  isEditing: boolean;
  editValue: string;
  onStartEdit: () => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  className?: string;
  annotation?: React.ReactNode;
};

export type YearRowProps = {
  row: AnnualRow;
  accounts: AccountRow[];
  activeAccountCount?: number;
  isExpanded: boolean;
  onToggle: () => void;
  showAccounts: boolean;
  editingCell: EditingCell;
  editValue: string;
  onStartEdit: (
    type: "annual" | "account" | "master" | "basis",
    id: number,
    field: string,
    currentValue: number,
  ) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  masterAccounts: MasterAccount[];
  showBasis: boolean;
  showUnrealized: boolean;
  onlyBasis: boolean;
  canEdit?: boolean;
  /** Open an account row's notes, estimates and checks. */
  onOpenNotes?: (account: AccountRow) => void;
};

export type AddAccountFormProps = {
  year: number;
  parentCategory: string;
  masterAccounts: MasterAccount[];
  onSave: (data: CreateAccountData) => void;
  onCancel: () => void;
  isSaving: boolean;
};

export type YoYComparisonProps = {
  years: Set<number>;
  data: AnnualRow[];
};

export type UpdateFormRow = {
  accountPerformanceId: number;
  performanceAccountId: number | null;
  displayName: string;
  institution: string;
  parentCategory: string;
  accountType: string | null;
  subType: string | null;
  /** Beginning balance as typed (starts at the stored figure). */
  beginningBalance: string;
  /** Last year's ending for this account (part), when this year doesn't
   *  start there — from the row's `chain` check. */
  previousEnding: number | null;
  /** Employee-only portion of contributions (totalContributions - employerContributions). */
  employeeContrib: string;
  employerContributions: string;
  distributions: string;
  rollovers: string;
  fees: string;
  endingBalance: string;
  yearlyGainLoss: string;
  gainLossOverride: boolean;
  /** The household's note and still-estimated figures for this row. */
  note: string;
  estimatedFields: PerfField[];
  /** Snapshot ending balance for this account (null if no snapshot match). */
  snapshotEndingBalance: number | null;
  /** Original DB values at form open, for "was" hints. */
  original: {
    beginningBalance: number;
    employeeContrib: number;
    employerContributions: number;
    distributions: number;
    rollovers: number;
    fees: number;
    endingBalance: number;
  };
};

export type UpdatePerformanceFormProps = {
  currentYear: number;
  accountRows: AccountRow[];
  onClose: () => void;
  onSaved: () => void;
};

export type LifetimeTotals = {
  endingBalance: number;
  gains: number;
  contributions: number;
  match: number;
  fees: number;
};

export type AccountFilterState = {
  selectedAccountIds: Set<number>;
  /** null = "Since Inception" */
  yearRange: { start: number; end: number } | null;
};
