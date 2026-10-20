import { describe, it, expect } from "vitest";
import {
  planChanges,
  planInUseMessage,
  planMatchesActive,
  planProfileIds,
} from "@/lib/pure/plans";

const active = { salary: 1, contribution: 2, budget: 3, retirement: 4 };

describe("planMatchesActive", () => {
  it("in use when all four are the active ones", () => {
    expect(planMatchesActive({ ...active }, active)).toBe(true);
    expect(planMatchesActive({ ...active, budget: 9 }, active)).toBe(false);
  });

  it("a Plan with an empty slot (saved before all four were required) is never in use", () => {
    expect(planMatchesActive({ ...active, retirement: null }, active)).toBe(
      false,
    );
    expect(
      planMatchesActive(
        { salary: null, contribution: null, budget: null, retirement: null },
        active,
      ),
    ).toBe(false);
  });
});

describe("planChanges", () => {
  it("lists only the kinds that would change", () => {
    expect(planChanges({ ...active, salary: 7, budget: 8 }, active)).toEqual([
      { kind: "salary", id: 7 },
      { kind: "budget", id: 8 },
    ]);
  });

  it("skips empty slots and kinds already active", () => {
    expect(planChanges({ ...active, contribution: null }, active)).toEqual([]);
  });
});

describe("planProfileIds / planInUseMessage", () => {
  it("keys a Plan row by kind", () => {
    expect(
      planProfileIds({
        salaryProfileId: 1,
        contributionProfileId: 2,
        budgetProfileId: 3,
        retirementProfileId: null,
      }),
    ).toEqual({ ...active, retirement: null });
  });

  it("names the Plans in the refusal", () => {
    expect(planInUseMessage("budget", ["A"])).toBe(
      "Can't delete: used by Plan A. Choose a different budget profile in that Plan first.",
    );
    expect(planInUseMessage("salary", ["A", "B"])).toContain(
      "used by Plans A, B",
    );
  });
});
