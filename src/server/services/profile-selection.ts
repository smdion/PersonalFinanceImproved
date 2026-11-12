// The Contribution and Salary Profiles a request runs on: each one the page
// picked, else the active one (DESIGN § Profile Resolution).
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import type { PayProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import type { RequestScope } from "@/server/data/request-scope";
import { activeProfileIdFrom } from "@/server/data/active-profile";

export type ProfilePair = {
  contribProfileId: number | null;
  salaryProfileId: number | null;
};

export async function resolveProfileSelection(
  scope: Pick<RequestScope, "db">,
  selection: PayProfileSelection = {},
): Promise<ProfilePair> {
  const { contribution, salary } = selection;
  if (contribution !== undefined && salary !== undefined)
    return { contribProfileId: contribution, salaryProfileId: salary };
  const settingRows = await scope.db
    .select()
    .from(schema.appSettings)
    .where(
      inArray(schema.appSettings.key, [
        SK_ACTIVE_CONTRIB_PROFILE_ID,
        SK_ACTIVE_SALARY_PROFILE_ID,
      ]),
    );
  return {
    contribProfileId:
      contribution !== undefined
        ? contribution
        : activeProfileIdFrom(settingRows, "contribution"),
    salaryProfileId:
      salary !== undefined
        ? salary
        : activeProfileIdFrom(settingRows, "salary"),
  };
}

/** A resolved pair as a summary's profile ids. */
export function summaryProfileIdsInput(pair: ProfilePair) {
  return {
    ...(pair.contribProfileId != null
      ? { contributionProfileId: pair.contribProfileId }
      : {}),
    ...(pair.salaryProfileId != null
      ? { salaryProfileId: pair.salaryProfileId }
      : {}),
  };
}
