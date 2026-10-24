/** IRS-limit caps on contributions. Invented figures only. */
import { describe, it, expect } from "vitest";
import {
  capContributionsByLimitGroup,
  type CapPerson,
  type CapRow,
} from "@/lib/pure/contribution-caps";

const limits = {
  "401k_employee_limit": 20000,
  "401k_catchup_limit": 7000,
  "401k_super_catchup_limit": 10000,
  ira_limit: 6000,
  ira_catchup_limit: 1000,
  hsa_individual_limit: 4000,
  hsa_family_limit: 8000,
  hsa_catchup_limit: 1000,
};
const TAX_YEAR = 2030;

let nextId = 1;
function row(
  over: Partial<CapRow> & Pick<CapRow, "personId" | "accountType">,
): CapRow {
  return {
    id: nextId++,
    hsaCoverageType: null,
    regularAnnual: 0,
    bonusAnnual: 0,
    employerAnnual: 0,
    reducesCompensation: false,
    ...over,
  };
}
/** A person who is `age` at Dec 31 of the tax year. */
function person(
  id: number,
  age: number | null,
  wages: number | null = 100000,
): CapPerson {
  return { id, birthYear: age === null ? null : TAX_YEAR - age, wages };
}
function cap(
  rows: CapRow[],
  people: CapPerson[],
  filingStatus = "Single",
  lim: Record<string, number> = limits,
) {
  return capContributionsByLimitGroup(rows, {
    taxYear: TAX_YEAR,
    filingStatus,
    limits: lim,
    people,
  });
}

describe("capContributionsByLimitGroup — 401(k) group", () => {
  it("leaves a contribution within the limit alone", () => {
    const r = row({ personId: 1, accountType: "401k", regularAnnual: 15000 });
    const out = cap([r], [person(1, 40)]).get(r.id)!;
    expect(out).toEqual({
      group: "401k",
      annual: 15000,
      regularAnnual: 15000,
      bonusAnnual: 0,
      cappedAnnual: 15000,
      overBy: 0,
      limit: 20000,
      maxEmployee: 20000,
      reason: null,
    });
  });

  it("caps one person's Roth + Traditional rows by one factor, regular and bonus alike", () => {
    const trad = row({
      personId: 1,
      accountType: "401k",
      regularAnnual: 12000,
      bonusAnnual: 3000,
    });
    const roth = row({
      personId: 1,
      accountType: "401k",
      regularAnnual: 10000,
    });
    const out = cap([trad, roth], [person(1, 40)]);
    const t = out.get(trad.id)!;
    const ro = out.get(roth.id)!;
    expect(t.cappedAnnual + ro.cappedAnnual).toBeCloseTo(20000, 2);
    expect(t.cappedAnnual / ro.cappedAnnual).toBeCloseTo(15000 / 10000, 6);
    expect(t.bonusAnnual / t.regularAnnual).toBeCloseTo(3000 / 12000, 3);
    expect(t.regularAnnual + t.bonusAnnual).toBeCloseTo(t.cappedAnnual, 2);
    expect(t.reason).toBe("over-limit");
    expect(t.overBy).toBeCloseTo(3000, 2);
  });

  it("shares one 402(g) limit across a 401(k) and a 403(b) at two employers", () => {
    const a = row({ personId: 1, accountType: "401k", regularAnnual: 15000 });
    const b = row({ personId: 1, accountType: "403b", regularAnnual: 15000 });
    const out = cap([a, b], [person(1, 40)]);
    expect(out.get(a.id)!.cappedAnnual).toBeCloseTo(10000, 2);
    expect(out.get(b.id)!.cappedAnnual).toBeCloseTo(10000, 2);
  });

  it("caps each spouse against their own limit — one's excess never hides in the other's room", () => {
    const a = row({ personId: 1, accountType: "401k", regularAnnual: 25000 });
    const b = row({ personId: 2, accountType: "401k", regularAnnual: 5000 });
    const out = cap([a, b], [person(1, 40), person(2, 40)], "MFJ");
    expect(out.get(a.id)!.cappedAnnual).toBe(20000);
    expect(out.get(b.id)!.cappedAnnual).toBe(5000);
  });

  it("does not count employer match toward the 402(g) limit", () => {
    const r = row({
      personId: 1,
      accountType: "401k",
      regularAnnual: 20000,
      employerAnnual: 9000,
    });
    expect(cap([r], [person(1, 40)]).get(r.id)!.cappedAnnual).toBe(20000);
  });

  it.each([
    [49, 20000],
    [50, 27000],
    [59, 27000],
    [60, 30000],
    [63, 30000],
    [64, 27000],
  ])("age %i at Dec 31 → limit %i", (age, limit) => {
    const r = row({ personId: 1, accountType: "401k", regularAnnual: 40000 });
    const out = cap([r], [person(1, age)]).get(r.id)!;
    expect(out.limit).toBe(limit);
    expect(out.cappedAnnual).toBe(limit);
  });
});

describe("capContributionsByLimitGroup — HSA", () => {
  it("counts employer money toward the limit and cuts only the employee part", () => {
    const r = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 4000,
      employerAnnual: 1000,
    });
    const out = cap([r], [person(1, 40)]).get(r.id)!;
    expect(out.cappedAnnual).toBe(3000);
    expect(out.limit).toBe(4000);
  });

  it("employer money alone over the limit leaves the employee nothing", () => {
    const r = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 1000,
      employerAnnual: 5000,
    });
    expect(cap([r], [person(1, 40)]).get(r.id)!.cappedAnnual).toBe(0);
  });

  it("married with family coverage on either side: both spouses share one family limit", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 6000,
    });
    const b = row({
      personId: 2,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 6000,
    });
    const out = cap([a, b], [person(1, 40), person(2, 40)], "MFJ");
    expect(
      out.get(a.id)!.cappedAnnual + out.get(b.id)!.cappedAnnual,
    ).toBeCloseTo(8000, 2);
    expect(out.get(a.id)!.cappedAnnual).toBeCloseTo(4000, 2);
  });

  it("a spouse's 55+ catch-up is their own, on top of the shared family limit", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 6000,
    });
    const b = row({
      personId: 2,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 6000,
    });
    const out = cap([a, b], [person(1, 55), person(2, 54)], "MFJ");
    const ca = out.get(a.id)!.cappedAnnual;
    const cb = out.get(b.id)!.cappedAnnual;
    // 8,000 shared + spouse 1's 1,000 catch-up = 9,000.
    expect(ca + cb).toBeCloseTo(9000, 2);
    // Spouse 1's catch-up stays theirs: 1,000 + half of the shared cut.
    expect(ca).toBeCloseTo(1000 + 5000 * (8000 / 11000), 2);
    expect(out.get(a.id)!.limit).toBe(9000);
    expect(out.get(b.id)!.limit).toBe(8000);
  });

  it("unmarried: each person up to their own coverage's limit", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 8000,
    });
    const b = row({
      personId: 2,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 8000,
    });
    const out = cap([a, b], [person(1, 40), person(2, 40)], "HOH");
    expect(out.get(a.id)!.cappedAnnual).toBe(8000);
    expect(out.get(b.id)!.cappedAnnual).toBe(8000);
  });

  it("married, both self-only: per person", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 5000,
    });
    const b = row({
      personId: 2,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 1000,
    });
    const out = cap([a, b], [person(1, 40), person(2, 40)], "MFJ");
    expect(out.get(a.id)!.cappedAnnual).toBe(4000);
    expect(out.get(b.id)!.cappedAnnual).toBe(1000);
  });

  it("flags and doesn't cap an HSA with no coverage type", () => {
    const r = row({ personId: 1, accountType: "hsa", regularAnnual: 99000 });
    const out = cap([r], [person(1, 40)]).get(r.id)!;
    expect(out.cappedAnnual).toBe(99000);
    expect(out.reason).toBe("no-coverage");
    expect(out.limit).toBeNull();
  });
});

describe("capContributionsByLimitGroup — IRA compensation bound", () => {
  it("caps at the lower of the limit and compensation", () => {
    const r = row({ personId: 1, accountType: "ira", regularAnnual: 6000 });
    const out = cap([r], [person(1, 40, 2500)]).get(r.id)!;
    expect(out.cappedAnnual).toBe(2500);
    expect(out.reason).toBe("over-compensation");
  });

  it("married filing jointly: a spousal IRA uses the couple's combined compensation", () => {
    const a = row({ personId: 1, accountType: "ira", regularAnnual: 6000 });
    const b = row({ personId: 2, accountType: "ira", regularAnnual: 6000 });
    const out = cap([a, b], [person(1, 40, 50000), person(2, 40, 0)], "MFJ");
    expect(out.get(a.id)!.cappedAnnual).toBe(6000);
    expect(out.get(b.id)!.cappedAnnual).toBe(6000);
    const low = cap([a, b], [person(1, 40, 9000), person(2, 40, 0)], "MFJ");
    expect(
      low.get(a.id)!.cappedAnnual + low.get(b.id)!.cappedAnnual,
    ).toBeCloseTo(9000, 2);
  });

  it("unknown compensation: capped at the limit only", () => {
    const r = row({ personId: 1, accountType: "ira", regularAnnual: 9000 });
    const out = cap([r], [person(1, 40, null)]).get(r.id)!;
    expect(out.cappedAnnual).toBe(6000);
    expect(out.reason).toBe("over-limit");
  });
});

describe("capContributionsByLimitGroup — not capped", () => {
  it("flags a joint row and a year without the limit", () => {
    const joint = row({
      personId: null,
      accountType: "401k",
      regularAnnual: 99000,
    });
    const out = cap([joint], [person(2, 40)]);
    expect(out.get(joint.id)!).toMatchObject({
      cappedAnnual: 99000,
      reason: "no-owner",
    });

    const r = row({ personId: 1, accountType: "401k", regularAnnual: 99000 });
    const { "401k_employee_limit": _, ...noLimit } = limits;
    expect(cap([r], [person(1, 40)], "Single", noLimit).get(r.id)!.reason).toBe(
      "no-limit-data",
    );
  });

  it("leaves types without an IRS limit untouched", () => {
    const r = row({
      personId: 1,
      accountType: "brokerage",
      regularAnnual: 99000,
    });
    expect(cap([r], [person(1, 40)]).get(r.id)!).toMatchObject({
      cappedAnnual: 99000,
      limit: null,
      reason: null,
    });
  });
});

describe("capContributionsByLimitGroup — unknown birth year", () => {
  it("caps at the most any age allows and flags the row", () => {
    const r = row({ personId: 1, accountType: "401k", regularAnnual: 99000 });
    expect(cap([r], [person(1, null)]).get(r.id)!).toMatchObject({
      cappedAnnual: 30000, // base + the larger (super) catch-up
      reason: "no-birth-date",
    });
  });

  it("still caps a shared family HSA when one spouse's birth year is unknown", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 20000,
    });
    const b = row({ personId: 2, accountType: "hsa", regularAnnual: 100 });
    const out = cap([a, b], [person(1, 40), person(2, null)], "MFJ");
    // Spouse 2 gets the largest catch-up as their own room, so the 100
    // fits there; spouse 1 is held to the shared family limit.
    expect(out.get(a.id)!.cappedAnnual).toBe(8000);
    expect(out.get(a.id)!.reason).toBe("over-limit");
    expect(out.get(b.id)!).toMatchObject({
      cappedAnnual: 100,
      reason: "no-birth-date",
    });
  });

  it("still applies the compensation bound to an IRA", () => {
    const r = row({ personId: 1, accountType: "ira", regularAnnual: 5000 });
    expect(cap([r], [person(1, null, 0)]).get(r.id)!.cappedAnnual).toBe(0);
  });
});

describe("capContributionsByLimitGroup — the most a person can put in", () => {
  it("is the limit less employer money that counts", () => {
    const r = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      regularAnnual: 1000,
      employerAnnual: 1500,
    });
    expect(cap([r], [person(1, 40)]).get(r.id)!.maxEmployee).toBe(2500);
  });

  it("in a shared family HSA, is what the other spouse leaves", () => {
    const a = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 3000,
    });
    const b = row({
      personId: 2,
      accountType: "hsa",
      hsaCoverageType: "family",
      regularAnnual: 2000,
      employerAnnual: 1000,
    });
    const out = cap([a, b], [person(1, 40), person(2, 40)], "MFJ");
    expect(out.get(a.id)!.maxEmployee).toBe(5000); // 8,000 − 3,000 of spouse 2's
    expect(out.get(b.id)!.maxEmployee).toBe(4000); // 8,000 − 3,000 − 1,000 employer
  });

  it("is the same on each of a person's rows in the group", () => {
    const a = row({ personId: 1, accountType: "401k", regularAnnual: 5000 });
    const b = row({ personId: 1, accountType: "403b", regularAnnual: 5000 });
    const out = cap([a, b], [person(1, 40)]);
    expect(out.get(a.id)!.maxEmployee).toBe(20000);
    expect(out.get(b.id)!.maxEmployee).toBe(20000);
    expect(out.get(a.id)!.group).toBe("401k");
  });
});

describe("capContributionsByLimitGroup — employer money over the limit", () => {
  it("flags employer money alone over the limit, even with no employee money", () => {
    const r = row({
      personId: 1,
      accountType: "hsa",
      hsaCoverageType: "self_only",
      employerAnnual: 5000,
    });
    expect(cap([r], [person(1, 40)]).get(r.id)!).toMatchObject({
      cappedAnnual: 0,
      maxEmployee: 0,
      reason: "employer-over-limit",
    });
  });
});

describe("capContributionsByLimitGroup — spousal IRA and compensation", () => {
  it("funds a non-earning spouse's IRA from the other spouse's pay", () => {
    const r = row({ personId: 2, accountType: "ira", regularAnnual: 6000 });
    const out = cap([r], [person(1, 40, 100000), person(2, 40, 0)], "MFJ");
    expect(out.get(r.id)!).toMatchObject({ cappedAnnual: 6000, reason: null });
  });

  it("takes capped pre-tax payroll money off compensation", () => {
    const k = row({
      personId: 1,
      accountType: "401k",
      regularAnnual: 25000, // capped to 20,000
      reducesCompensation: true,
    });
    const ira = row({ personId: 1, accountType: "ira", regularAnnual: 6000 });
    const out = cap([k, ira], [person(1, 40, 24000)]);
    expect(out.get(ira.id)!).toMatchObject({
      cappedAnnual: 4000, // 24,000 − 20,000
      maxEmployee: 4000,
      reason: "over-compensation",
    });
  });

  it("married filing jointly with anyone's pay unknown: no compensation bound", () => {
    const r = row({ personId: 2, accountType: "ira", regularAnnual: 6000 });
    const out = cap([r], [person(1, 40, null), person(2, 40, 0)], "MFJ");
    expect(out.get(r.id)!.cappedAnnual).toBe(6000);
  });
});
