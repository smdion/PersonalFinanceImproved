// The Contribution and Salary Profiles a request runs on: each one the page
// picked (null: none), else the active one (DESIGN § Profile Resolution).
import { TRPCError } from "@trpc/server";
import { inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import type { PayProfileSelection } from "@/lib/pure/household/profile-selection.schema";
import type { RequestScope } from "@/server/data/request-scope";
import { zPaycheckSummaryInput } from "@/server/services/paycheck/summary";

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

/** The id fields of the paycheck and contribution summaries' inputs (the
 *  two schemas declare them alike). */
const summaryProfileIds = zPaycheckSummaryInput
  .unwrap()
  .pick({ contributionProfileId: true, salaryProfileId: true });

/** A resolved pair as a summary's profile ids, parsed as that summary's
 *  procedure parses its input: a stored active id that isn't a whole
 *  number is refused with the same BAD_REQUEST. */
export function summaryProfileIdsInput(pair: ProfilePair) {
  const parsed = summaryProfileIds.safeParse({
    ...(pair.contribProfileId != null
      ? { contributionProfileId: pair.contribProfileId }
      : {}),
    ...(pair.salaryProfileId != null
      ? { salaryProfileId: pair.salaryProfileId }
      : {}),
  });
  if (!parsed.success)
    throw new TRPCError({ code: "BAD_REQUEST", cause: parsed.error });
  return parsed.data;
}
