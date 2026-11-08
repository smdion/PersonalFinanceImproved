/** The read-only panel's account rows. */
import {
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
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

  return profile.accountDetails.map((ad, rowIdx) => {
    const af = ad.activeFields as ContribAccountActiveFields;
    const {
      hasValue,
      isDisabled: isProfileDisabled,
      value: activeValue,
      methodSuffix,
    } = resolveContribFieldDisplayState(af);
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
          rowIdx % 2 === 1 ? "bg-surface-sunken/60" : "bg-surface-primary"
        } ${isProfileDisabled ? "opacity-40" : ""}`}
      >
        {ACCOUNT_FIELDS.map(({ key, readOnly }) => {
          const Cell = DETAIL_CELLS[key];
          return readOnly && Cell ? <Cell key={key} {...row} /> : null;
        })}
      </tr>
    );
  });
}
