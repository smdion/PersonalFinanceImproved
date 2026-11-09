/** createContext names a request's demo schema through demoSchemaName, so
 *  a cookie that isn't a demo profile's slug names no schema at all. */
import { describe, expect, it } from "vitest";
import { DEMO_PROFILES } from "@/lib/demo";
import {
  DEMO_PROFILE_SLUGS,
  demoSchemaName,
  isDemoProfileSlug,
} from "@/lib/demo/slugs";

describe("demoSchemaName", () => {
  it.each([
    ["single-income", "demo_single_income"],
    ["dual-income-family", "demo_dual_income_family"],
    ["early-retirement", "demo_early_retirement"],
    ["debt-payoff", "demo_debt_payoff"],
    ["recently-retired", "demo_recently_retired"],
  ])("names %s's schema %s", (slug, schema) => {
    expect(demoSchemaName(slug)).toBe(schema);
  });

  it.each(["made-up-profile", "public", "single-income-2", "constructor", ""])(
    "names no schema for %j, a slug no profile has",
    (slug) => {
      expect(demoSchemaName(slug)).toBeNull();
    },
  );

  it("knows exactly the profiles DEMO_PROFILES holds", () => {
    expect([...DEMO_PROFILE_SLUGS].sort()).toEqual(
      Object.keys(DEMO_PROFILES).sort(),
    );
    expect(DEMO_PROFILE_SLUGS.every(isDemoProfileSlug)).toBe(true);
  });
});
