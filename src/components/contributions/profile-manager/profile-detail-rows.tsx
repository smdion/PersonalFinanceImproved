/** The read-only panel's account rows. */
import {
  resolveContributionFieldDisplayState,
  type ContributionAccountActiveFields,
} from "@/lib/pure/household/profiles";
import { groupSharedMatchAccounts } from "./match-groups";
import type { ProfileDetail } from "./account-row-types";
import { ACCOUNT_FIELDS } from "./account-fields";
import { DETAIL_CELLS } from "./detail-cells";

export function renderDetailAccountRows(profile: ProfileDetail) {
  // A Roth/Traditional split of one account shares one match,
  // entered on one row and applied to their combined
  // contributions: every row in the group shows the same match
  // text (when exactly one row holds the match; else per row).
  const { sharedMatchSource, combinedGroupIds } = groupSharedMatchAccounts(
    profile.accountDetails,
  );

  return profile.accountDetails.map((ad, rowIndex) => {
    const af = ad.activeFields as ContributionAccountActiveFields;
    const {
      hasValue,
      isDisabled: isProfileDisabled,
      value: activeValue,
      methodSuffix,
    } = resolveContributionFieldDisplayState(af);
    const activeMethod = af?.contributionMethod;
    const hasActiveName =
      ad.liveAccountName && ad.accountName !== ad.liveAccountName;
    const sharedFrom = sharedMatchSource.get(ad.id);
    const matchSource = sharedFrom ?? ad;
    const isCombined = combinedGroupIds.has(ad.id);
    const row = {
      ad,
      af,
      isProfileDisabled,
      hasActiveName,
      activeMethod,
      hasValue,
      methodSuffix,
      activeValue,
      matchSource,
      isCombined,
    };
    return (
      <tr
        key={ad.id}
        className={`border-subtle border-b transition-colors hover:bg-blue-50/60 ${
          rowIndex % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
        } ${isProfileDisabled ? "opacity-40" : ""}`}
      >
        {ACCOUNT_FIELDS.map((field) => {
          const Cell = field.readOnly ? DETAIL_CELLS[field.key] : null;
          return Cell ? <Cell key={field.key} {...row} /> : null;
        })}
      </tr>
    );
  });
}
