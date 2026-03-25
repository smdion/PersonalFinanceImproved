/**
 * Tests for pure profile management, active job detection, and profile linking logic.
 * Covers: canDeleteBudgetProfile, canDeleteContribProfile, canRemoveColumn,
 * findActiveJob, filterActiveJobs, resolveLinkedProfile, canDeletePerformanceAccount.
 */
import { describe, it, expect } from "vitest";
import {
  canDeleteBudgetProfile,
  canDeleteContribProfile,
  canRemoveColumn,
  findActiveJob,
  filterActiveJobs,
  resolveLinkedProfile,
  canDeletePerformanceAccount,
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
  it("allows deleting non-default, non-active profile", () => {
    expect(canDeleteContribProfile({ isDefault: false }, null, 5)).toEqual({
      allowed: true,
    });
  });

  it("prevents deleting default profile", () => {
    const result = canDeleteContribProfile({ isDefault: true }, null, 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("default");
  });

  it("prevents deleting currently active profile", () => {
    const result = canDeleteContribProfile({ isDefault: false }, 5, 5);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("active");
  });

  it("allows when activeProfileId is different", () => {
    expect(canDeleteContribProfile({ isDefault: false }, 3, 5)).toEqual({
      allowed: true,
    });
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
    { personId: 1, endDate: "2023-12-31", name: "old" },
    { personId: 1, endDate: null, name: "current" },
    { personId: 2, endDate: null, name: "other" },
  ];

  it("finds active job for person", () => {
    const job = findActiveJob(jobs, 1);
    expect(job?.name).toBe("current");
  });

  it("returns undefined when no active job", () => {
    const ended = [{ personId: 1, endDate: "2023-01-01" }];
    expect(findActiveJob(ended, 1)).toBeUndefined();
  });

  it("returns undefined for unknown person", () => {
    expect(findActiveJob(jobs, 99)).toBeUndefined();
  });
});

describe("filterActiveJobs", () => {
  it("returns only jobs without endDate", () => {
    const jobs = [
      { endDate: null, name: "a" },
      { endDate: "2023-01-01", name: "b" },
      { endDate: null, name: "c" },
    ];
    const active = filterActiveJobs(jobs);
    expect(active).toHaveLength(2);
    expect(active.map((j) => j.name)).toEqual(["a", "c"]);
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
