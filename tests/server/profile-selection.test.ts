/**
 * resolveProfileSelection (DESIGN § Profile Resolution): a budget or
 * savings request runs on each pay profile the page picked, else the
 * active one; null picks none.
 */
import "../routers/setup-mocks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "@/lib/db/schema-sqlite";
import {
  SK_ACTIVE_CONTRIB_PROFILE_ID,
  SK_ACTIVE_SALARY_PROFILE_ID,
} from "@/lib/constants/settings-keys";
import { resolveProfileSelection } from "@/server/services/profile-selection";
import { createTestCaller } from "../routers/setup";

describe("resolveProfileSelection", () => {
  let harness: Awaited<ReturnType<typeof createTestCaller>>;
  beforeAll(async () => {
    harness = await createTestCaller();
    for (const [key, value] of [
      [SK_ACTIVE_CONTRIB_PROFILE_ID, "7"],
      [SK_ACTIVE_SALARY_PROFILE_ID, "8"],
    ] as const) {
      harness.db
        .delete(sqliteSchema.appSettings)
        .where(eq(sqliteSchema.appSettings.key, key))
        .run();
      harness.db.insert(sqliteSchema.appSettings).values({ key, value }).run();
    }
  });
  afterAll(() => harness.cleanup());

  const scope = () => ({ db: harness.rawDb });

  it("takes the active profiles when nothing is picked", async () => {
    expect(await resolveProfileSelection(scope())).toEqual({
      contribProfileId: 7,
      salaryProfileId: 8,
    });
  });

  it("takes each pick over the active one, and null as none", async () => {
    expect(await resolveProfileSelection(scope(), { contribution: 2 })).toEqual(
      { contribProfileId: 2, salaryProfileId: 8 },
    );
    expect(
      await resolveProfileSelection(scope(), { contribution: null, salary: 3 }),
    ).toEqual({ contribProfileId: null, salaryProfileId: 3 });
  });
});
