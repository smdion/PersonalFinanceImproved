// The Contribution and Salary Profiles a request runs on: each one the page
// picked (null: none), else the active one (DESIGN § Profile Resolution).
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import type { PayProfileSelection } from "@/lib/pure/household/profile-selection";
import type { RequestScope } from "@/server/data/request-scope";

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
  const active = (key: string): number | null => {
    const raw = settingRows.find((r) => r.key === key)?.value ?? null;
    const num = Number(raw);
    return raw == null || Number.isNaN(num) ? null : num;
  };
  return {
    contribProfileId:
      contribution !== undefined
        ? contribution
        : active(SK_ACTIVE_CONTRIB_PROFILE_ID),
    salaryProfileId:
      salary !== undefined ? salary : active(SK_ACTIVE_SALARY_PROFILE_ID),
  };
}
