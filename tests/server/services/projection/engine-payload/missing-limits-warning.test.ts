/**
 * A year's tax data missing an IRS limit an earlier year had: the limit
 * still reads as $0, and the projection says so.
 */
import { describe, expect, it } from "vitest";
import { missingLimitsWarning } from "@/server/services/projection/engine-payload/tax-year";

const rows = (taxYear: number, keys: string[]) =>
  keys.map((limitType) => ({ taxYear, limitType }));

describe("missingLimitsWarning", () => {
  it("is quiet when the year has every account limit an earlier year had", () => {
    const all = [
      ...rows(2025, ["401k_employee_limit", "401k_catchup_limit"]),
      ...rows(2026, ["401k_employee_limit", "401k_catchup_limit"]),
    ];
    expect(
      missingLimitsWarning(
        { "401k_employee_limit": 24500, "401k_catchup_limit": 8000 },
        all,
        2026,
      ),
    ).toEqual([]);
  });

  it("names a limit an earlier year had and this year lacks", () => {
    const all = [
      ...rows(2025, ["401k_employee_limit", "401k_catchup_limit"]),
      ...rows(2026, ["401k_employee_limit"]),
    ];
    const [warning] = missingLimitsWarning(
      { "401k_employee_limit": 24500 },
      all,
      2026,
    );
    expect(warning).toBe(
      "The 2026 tax data has no 401k catch-up (50+) limit, so it counts as $0. Add it in Settings → Reference Data.",
    );
  });

  it("does not ask an older year for a limit only later years have", () => {
    const all = [
      ...rows(2024, ["401k_employee_limit"]),
      ...rows(2025, ["401k_employee_limit", "401k_super_catchup_limit"]),
    ];
    expect(
      missingLimitsWarning({ "401k_employee_limit": 23000 }, all, 2024),
    ).toEqual([]);
  });

  it("ignores a key that is not an account limit", () => {
    const all = rows(2025, ["standard_deduction_mfj"]);
    expect(missingLimitsWarning({}, all, 2026)).toEqual([]);
  });
});
