import type { RouterOutputs, trpc } from "@/lib/trpc";

/** A profile as contributionProfile.getById returns it, and one account row. */
export type ProfileDetail = NonNullable<
  RouterOutputs["contributionProfile"]["getById"]
>;
export type AccountDetail = ProfileDetail["accountDetails"][number];

/** The create form's typed-but-unsaved match and contribution entries. */
export type MatchDraft = {
  matchType?: string;
  matchValue?: string;
  maxMatchPercent?: string;
};
export type ContributionDraft = { method?: string; value?: string };

/** One account row's values and callbacks, as each inline-editor cell reads them. */
export type InlineRowProps = {
  isDisabled: boolean;
  ad: AccountDetail;
  af: Record<string, unknown>;
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
  clearDraft: (key: string) => void;
  patchAccount: (accountId: number, changes: Record<string, unknown>) => void;
  setAccountActive: ReturnType<
    typeof trpc.contribution.accounts.setActive.useMutation
  >;
  commitText: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
  ) => void;
  commitNumeric: (
    draftKey: string,
    stored: string,
    apply: (value: unknown) => void,
    toValue: (num: number) => unknown,
  ) => void;
  storedName: string;
  effectiveMethod: string;
  storedValue: string;
  isPercent: boolean;
  effectiveMatchType: string;
  hasMatch: boolean;
  storedMatch: string;
  ownMatch: string | null;
  sharedFrom: AccountDetail | undefined;
  isPercentMatch: boolean;
  storedCap: string;
};

/** The stored shape of contribution_profiles.contribution_active_fields:
 *  the profile's fields per contribution account and per deduction. */
export type ActiveFieldsRoot = {
  contributionAccounts?: Record<string, Record<string, unknown>>;
  deductions?: Record<string, Record<string, unknown>>;
};

/** A raw paycheck_deductions row, as returned by paycheck.deductions.list. */
export type DeductionRow = {
  id: number;
  jobId: number;
  deductionName: string;
  isPretax: boolean;
  ficaExempt: boolean;
};
