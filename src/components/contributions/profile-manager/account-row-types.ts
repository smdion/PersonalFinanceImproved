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
  maxMatchPct?: string;
};
export type ContribDraft = { method?: string; value?: string };

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
    typeof trpc.settings.contributionAccounts.setActive.useMutation
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
