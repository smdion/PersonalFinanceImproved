/**
 * Where a household pays IRMAA, on every path that inserts a retirement
 * settings row: a new household's first save and the demo seed start on
 * top of the budget; a saved choice is kept; a person added to the
 * profiles and a duplicated profile copy their source's choice.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import * as s from "@/lib/db/schema-sqlite";
import { seedProfile } from "@/server/services/demo/demo-seed";
import { DEMO_PROFILES } from "@/lib/demo";
import { createTestCaller, seedPerson } from "./setup";
import { ROUTERS_ON_POSTGRES } from "./postgres-router-db";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

const settings = (personId: number) => ({
  personId,
  retirementAge: 62,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.025",
  salaryAnnualIncrease: "0.03",
});

const onTop = (db: Ctx["db"]) =>
  db
    .select({
      personId: s.retirementSettings.personId,
      profileId: s.retirementSettings.profileId,
      onTop: s.retirementSettings.irmaaOnTopOfBudget,
    })
    .from(s.retirementSettings)
    .all();

describe("IRMAA on top of the budget on every insert path", () => {
  it("a new household starts on top, and every copy keeps its source's choice", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      const alex = await seedPerson(db, "Alex", "1958-03-04");
      await seedPerson(db, "Sam", "1960-11-30");
      // First save: Alex's row, and Sam's cloned from it.
      await caller.retirement.retirementSettings.upsert(settings(alex));
      expect(onTop(db).map((r) => r.onTop)).toEqual([true, true]);

      // A saved "In my budget" is kept by a later save that doesn't send it.
      await caller.retirement.retirementSettings.upsert({
        ...settings(alex),
        irmaaOnTopOfBudget: false,
      });
      await caller.retirement.retirementSettings.upsert(settings(alex));
      const first = onTop(db).find((r) => r.personId === alex)!;
      expect(first.onTop).toBe(false);

      await caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: first.profileId!,
        name: "Copy",
      });
      await caller.people.create({ name: "Kai", dateOfBirth: "2000-01-01" });
      const rows = onTop(db);
      expect(rows).toHaveLength(6);
      expect(
        rows.filter((r) => r.personId === alex).map((r) => r.onTop),
      ).toEqual([false, false]);
    } finally {
      await cleanup();
    }
  });

  // Empties the tables the SQLite way, as roth-overlay-writers.test.ts does.
  it.skipIf(ROUTERS_ON_POSTGRES)(
    "the demo seed starts every row on top",
    async () => {
      const { rawDb, db, sqlite, cleanup } = await createTestCaller();
      try {
        sqlite.pragma("foreign_keys = OFF");
        for (const { name } of sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
          )
          .all() as { name: string }[])
          sqlite.prepare(`DELETE FROM "${name}"`).run();
        sqlite.pragma("foreign_keys = ON");
        await seedProfile(
          rawDb,
          DEMO_PROFILES["recently-retired"]!,
          new Date(),
        );
        const rows = onTop(db);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((r) => r.onTop)).toEqual(rows.map(() => true));
      } finally {
        await cleanup();
      }
    },
  );
});
