/**
 * Demo profiles are seeded straight into the database (services/demo/demo-seed.ts),
 * past every input check a real household's entries go through. So each
 * profile's rows are held to the same entry schemas here: a demo that seeds
 * a value no one could enter shows visitors figures no household could get
 * (a match cap of "4" read as 400% of pay offered a $687,750 match).
 */
import "../routers/setup-mocks";
import { describe, it, expect } from "vitest";
import { DEMO_PROFILES } from "@/lib/demo";
import { contributionAccountInput } from "@/server/routers/settings/contribution-accounts";

const profiles = Object.values(DEMO_PROFILES);

describe.each(profiles.map((p) => [p.slug, p] as const))(
  "demo profile %s",
  (_slug, profile) => {
    it("every contribution account passes the entry schema", () => {
      for (const ca of profile.contributionAccounts) {
        const parsed = contributionAccountInput.safeParse({
          jobId: ca.employerName ? 1 : null,
          personId: 1,
          accountType: ca.accountType,
          parentCategory: ca.parentCategory,
          taxTreatment: ca.taxTreatment,
          employerMatchType: ca.employerMatchType,
          employerMatchValue: ca.employerMatchValue,
          employerMatchRate: ca.employerMatchRate,
          employerMaxMatchPct: ca.employerMaxMatchPct,
          hsaCoverageType: ca.hsaCoverageType ?? null,
        });
        expect(
          parsed.success,
          `${ca.personName} ${ca.accountType}: ${parsed.error?.message}`,
        ).toBe(true);
      }
    });

    it("an account with a match, or sized as a share of pay, belongs to a current job of its owner", () => {
      // A match comes from an employer, and a percent of salary needs the
      // salary of the job it's deducted from.
      for (const ca of profile.contributionAccounts) {
        const needsJob =
          ca.employerMatchType !== "none" ||
          ca.contributionMethod === "percent_of_salary";
        if (!needsJob) continue;
        const job = profile.jobs.find(
          (j) =>
            j.employerName === ca.employerName &&
            j.personName === ca.personName,
        );
        expect(job, `${ca.personName} ${ca.accountType}`).toBeDefined();
        expect(job?.endDate ?? null).toBeNull();
      }
    });

    it("percent-of-salary contributions are whole-number percents of pay", () => {
      for (const ca of profile.contributionAccounts) {
        if (ca.contributionMethod !== "percent_of_salary") continue;
        const pct = Number(ca.contributionValue);
        expect(pct, `${ca.personName} ${ca.accountType}`).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    });
  },
);
