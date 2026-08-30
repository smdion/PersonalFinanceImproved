/**
 * Tests for pure profile management, active job detection, and profile linking logic.
 * Covers: canDeleteBudgetProfile, canDeleteContribProfile, canRemoveColumn,
 * findActiveJob, filterActiveJobs, resolveLinkedProfile, canDeletePerformanceAccount.
 */
import { describe, it, expect } from "vitest";
import {
  canDeleteBudgetProfile,
  canDeleteContribProfile,
  canDeleteSalaryProfile,
  canDeleteRetirementProfile,
  canRemoveColumn,
  findActiveJob,
  filterActiveJobs,
  resolveLinkedProfile,
  canDeletePerformanceAccount,
  resolveContribFieldDisplayState,
  type ContribAccountActiveFields,
} from "@/lib/pure/profiles";

describe("canDeleteBudgetProfile", () => {
  it("allows deleting inactive profile", () => {
    expect(canDeleteBudgetProfile({ isActive: false })).toEqual({
      allowed: true,
    });
  });

  it("prevents deleting active profile", () => {
    const result = canDeleteBudgetProfile({ isActive: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("active");
  });
});

describe("canDeleteContribProfile", () => {
  it("allows deleting a non-active profile when others remain", () => {
    expect(canDeleteContribProfile(null, 5, 3)).toEqual({ allowed: true });
  });

  it("prevents deleting the only remaining profile", () => {
    // The active-profile setting must always name a real row, so the last
    // profile of a kind is undeletable — this replaced the old isDefault flag.
    const result = canDeleteContribProfile(null, 1, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("only remaining");
  });

  it("prevents deleting currently active profile", () => {
    const result = canDeleteContribProfile(5, 5, 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("active");
  });

  it("allows when activeProfileId is different", () => {
    expect(canDeleteContribProfile(3, 5, 2)).toEqual({ allowed: true });
  });
});

describe("canDeleteSalaryProfile", () => {
  it("allows deleting a non-active profile when others remain", () => {
    expect(canDeleteSalaryProfile(null, 5, 3)).toEqual({ allowed: true });
  });

  it("prevents deleting the only remaining profile", () => {
    const result = canDeleteSalaryProfile(null, 1, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("only remaining");
  });

  it("prevents deleting currently active profile", () => {
    const result = canDeleteSalaryProfile(5, 5, 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("active");
  });

  it("has no id-0 sentinel — id 0 is just an id", () => {
    expect(canDeleteSalaryProfile(null, 0, 3).allowed).toBe(true);
  });
});

describe("canDeleteRetirementProfile", () => {
  it("allows deleting a non-active profile when others remain", () => {
    expect(canDeleteRetirementProfile(null, 5, 3)).toEqual({ allowed: true });
  });

  it("prevents deleting the only remaining profile", () => {
    const result = canDeleteRetirementProfile(null, 1, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("only remaining");
  });

  it("prevents deleting currently active profile", () => {
    const result = canDeleteRetirementProfile(5, 5, 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("active");
  });
});

describe("canRemoveColumn", () => {
  it("allows removing when multiple columns exist", () => {
    expect(canRemoveColumn(3, 1)).toEqual({ allowed: true });
  });

  it("prevents removing the last column", () => {
    const result = canRemoveColumn(1, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("last column");
  });

  it("prevents invalid column index", () => {
    const result = canRemoveColumn(3, 5);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Invalid");
  });

  it("allows removing index 0 when 2+ columns", () => {
    expect(canRemoveColumn(2, 0)).toEqual({ allowed: true });
  });
});

describe("findActiveJob", () => {
  const jobs = [
    { personId: 1, endDate: "2023-12-31", isSpeculative: false, name: "old" },
    { personId: 1, endDate: null, isSpeculative: false, name: "current" },
    { personId: 2, endDate: null, isSpeculative: false, name: "other" },
  ];

  it("finds active job for person", () => {
    const job = findActiveJob(jobs, 1);
    expect(job?.name).toBe("current");
  });

  it("returns undefined when no active job", () => {
    const ended = [
      { personId: 1, endDate: "2023-01-01", isSpeculative: false },
    ];
    expect(findActiveJob(ended, 1)).toBeUndefined();
  });

  it("returns undefined for unknown person", () => {
    expect(findActiveJob(jobs, 99)).toBeUndefined();
  });

  it("never returns a speculative job, even though it has no endDate", () => {
    // The auto-provisioned what-if peg — always endDate: null, but must
    // never be picked up as a person's real, active job.
    const withSpeculative = [
      { personId: 3, endDate: null, isSpeculative: true, name: "spec" },
    ];
    expect(findActiveJob(withSpeculative, 3)).toBeUndefined();
  });

  it("prefers a real active job over a speculative one for the same person", () => {
    const mixed = [
      { personId: 4, endDate: null, isSpeculative: true, name: "spec" },
      { personId: 4, endDate: null, isSpeculative: false, name: "real" },
    ];
    expect(findActiveJob(mixed, 4)?.name).toBe("real");
  });
});

describe("filterActiveJobs", () => {
  it("returns only jobs without endDate", () => {
    const jobs = [
      { endDate: null, isSpeculative: false, name: "a" },
      { endDate: "2023-01-01", isSpeculative: false, name: "b" },
      { endDate: null, isSpeculative: false, name: "c" },
    ];
    const active = filterActiveJobs(jobs);
    expect(active).toHaveLength(2);
    expect(active.map((j) => j.name)).toEqual(["a", "c"]);
  });

  it("excludes a speculative job even though it has no endDate", () => {
    const jobs = [
      { endDate: null, isSpeculative: false, name: "real" },
      { endDate: null, isSpeculative: true, name: "spec" },
    ];
    const active = filterActiveJobs(jobs);
    expect(active.map((j) => j.name)).toEqual(["real"]);
  });
});

describe("resolveLinkedProfile", () => {
  const profiles = [
    { id: 1, isActive: false, name: "saved" },
    { id: 2, isActive: true, name: "live" },
    { id: 3, isActive: false, name: "scenario" },
  ];

  it("returns linked profile when specified", () => {
    const p = resolveLinkedProfile(3, profiles);
    expect(p?.name).toBe("scenario");
  });

  it("falls back to active profile when no link", () => {
    const p = resolveLinkedProfile(null, profiles);
    expect(p?.name).toBe("live");
  });

  it("falls back to active when linkedProfileId is undefined", () => {
    const p = resolveLinkedProfile(undefined, profiles);
    expect(p?.name).toBe("live");
  });

  it("returns undefined when linked profile not found", () => {
    expect(resolveLinkedProfile(99, profiles)).toBeUndefined();
  });
});

describe("canDeletePerformanceAccount", () => {
  it("allows deletion when no references", () => {
    expect(canDeletePerformanceAccount(0)).toEqual({ allowed: true });
  });

  it("prevents deletion with references", () => {
    const result = canDeletePerformanceAccount(5);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("5 performance record");
    expect(result.reason).toContain("Deactivate");
  });
});

describe("resolveContribFieldDisplayState", () => {
  it("has no value when the profile carries no entry at all", () => {
    expect(resolveContribFieldDisplayState(null)).toEqual({
      hasValue: false,
      isDisabled: false,
      value: undefined,
      methodSuffix: "",
    });
  });

  it("treats an explicit zero value as a real, configured entry", () => {
    const state = resolveContribFieldDisplayState({
      contributionValue: "0",
      contributionMethod: "percent_of_salary",
    });
    expect(state.hasValue).toBe(true);
    expect(state.isDisabled).toBe(false);
    expect(state.value).toBe("0");
    expect(state.methodSuffix).toBe("%");
  });

  it("flags isDisabled only when isActive is explicitly false", () => {
    const state = resolveContribFieldDisplayState({
      contributionValue: "500",
      contributionMethod: "fixed_monthly",
      isActive: false,
    });
    expect(state.hasValue).toBe(true);
    expect(state.isDisabled).toBe(true);
    expect(state.methodSuffix).toBe("");
  });

  it("leaves methodSuffix empty for non-percent methods", () => {
    const state = resolveContribFieldDisplayState({
      contributionValue: "100",
      contributionMethod: "fixed_per_period",
    });
    expect(state.methodSuffix).toBe("");
  });

  it("has no value when an entry exists only for an unrelated field (e.g. a custom display name)", () => {
    // Reachable via the Profile Manager's "Custom name..." field, which can
    // patch displayNameActive onto an account that was never given a
    // contribution value. hasValue must key off contributionValue itself,
    // not "does an entry object exist" — otherwise this cell falls through
    // to rendering the literal string "undefined" (see git history/PR for
    // the live bug this regression test locks in).
    // displayNameActive isn't part of the narrow ContribAccountActiveFields
    // type this function reads, but real stored entries carry it alongside
    // these fields — build it as a loosely-typed record to simulate that.
    const entry: Record<string, unknown> = { displayNameActive: "Custom name" };
    const state = resolveContribFieldDisplayState(
      entry as ContribAccountActiveFields,
    );
    expect(state.hasValue).toBe(false);
    expect(state.isDisabled).toBe(false);
    expect(state.value).toBeUndefined();
  });
});
