import React from "react";

export type EditingCell = {
  type: "annual" | "account";
  id: number;
  field: string;
} | null;

export type AnnualRow = {
  id: number;
  year: number;
  category: string;
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
  isActive: boolean;
  performanceAccountId: number | null;
  displayOrder: number;
  year: number;
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
    type: "annual" | "account",
    id: number,
    field: string,
    currentValue: number,
  ) => void;
  onEditValueChange: (v: string) => void;
  onSaveEdit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDeleteAccount: (id: number, label: string) => void;
  showAddAccount: boolean;
  onShowAddAccount: () => void;
  onCreateAccount: (data: CreateAccountData) => void;
  onCancelAddAccount: () => void;
  isCreatingAccount: boolean;
  activeCategory: string;
  masterAccounts: MasterAccount[];
  canEdit?: boolean;
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

export type LifetimeTotals = {
  endingBalance: number;
  gains: number;
  contributions: number;
  match: number;
  fees: number;
};
