import type { RouterOutputs } from "@/lib/trpc";

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
