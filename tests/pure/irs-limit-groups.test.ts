/** IRS limits per limit group for the engine. Invented figures only. */
import { describe, it, expect } from "vitest";
import { computeIrsLimitGroups } from "@/lib/pure/irs-limit-groups";

const limitsMap = {
  "401k_employee_limit": 20000,
  "401k_catchup_limit": 7000,
  "401k_super_catchup_limit": 10000,
  ira_limit: 6000,
  ira_catchup_limit: 1000,
  hsa_individual_limit: 4000,
  hsa_family_limit: 8000,
  hsa_catchup_limit: 1000,
};
const people = [{ id: 1 }, { id: 2 }];
const birthYearByPersonId = new Map([
  [1, 1970],
  [2, 1985],
]);

describe("computeIrsLimitGroups", () => {
  it("adds each person's limit, counts a household limit once, and records catch-up participants", () => {
    const r = computeIrsLimitGroups({
      people,
      activeContribs: [
        { personId: 1, accountType: "401k" },
        { personId: 2, accountType: "401k" },
        { personId: 1, accountType: "hsa", hsaCoverageType: "family" },
        { personId: 2, accountType: "hsa", hsaCoverageType: "family" },
        { personId: 2, accountType: "ira" },
        { personId: null, accountType: "brokerage" },
      ],
      limitsMap,
      birthYearByPersonId,
    });
    expect(r.limitByGroup["401k"]).toBe(40000);
    expect(r.limitByGroup.hsa).toBe(8000); // family, once per household
    expect(r.limitByGroup.ira).toBe(6000);
    expect(r.catchupByGroup["401k"]).toBe(7000);
    expect(r.superCatchupByGroup["401k"]).toBe(10000);
    expect([...r.groupParticipants.get("401k")!]).toEqual([
      [1, 1970],
      [2, 1985],
    ]);
  });

  it("leaves joint contributions out of per-person limits", () => {
    const r = computeIrsLimitGroups({
      people,
      activeContribs: [{ personId: null, accountType: "ira" }],
      limitsMap,
      birthYearByPersonId,
    });
    expect(r.limitByGroup).toEqual({});
  });

  it("fails loudly when a needed limit isn't seeded", () => {
    expect(() =>
      computeIrsLimitGroups({
        people,
        activeContribs: [{ personId: 1, accountType: "ira" }],
        limitsMap: {},
        birthYearByPersonId,
      }),
    ).toThrow(/ira_limit/);
  });
});
