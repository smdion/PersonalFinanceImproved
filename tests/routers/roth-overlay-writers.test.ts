/**
 * Every path that inserts a retirement settings row states its Roth bracket
 * overlay switch (tag 0022's converter turns an empty one on, so a replay
 * would undo a saved "off"): a new household's first save, a person added
 * to the profiles, a duplicated profile and the demo seed. A new household
 * starts off; a copy keeps its source's switch. A sent `rothBracketTarget:
 * null` turns the overlay off and keeps the stored target.
 */
import "./setup-mocks";
import { describe, it, expect } from "vitest";
import * as s from "@/lib/db/schema-sqlite";
import { seedProfile } from "@/server/services/demo/demo-seed";
import { DEMO_PROFILES } from "@/lib/demo";
import { createTestCaller, seedPerson } from "./setup";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

const settings = (personId: number) => ({
  personId,
  retirementAge: 62,
  endAge: 95,
  returnAfterRetirement: "0.05",
  annualInflation: "0.025",
  salaryAnnualIncrease: "0.03",
});

const switches = (db: Ctx["db"]) =>
  db
    .select({
      personId: s.retirementSettings.personId,
      profileId: s.retirementSettings.profileId,
      overlay: s.retirementSettings.rothBracketOverlay,
      target: s.retirementSettings.rothBracketTarget,
    })
    .from(s.retirementSettings)
    .all();

describe("the Roth bracket overlay switch on every insert path", () => {
  it("a new household starts off, and every copy keeps its source's switch", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      const alex = await seedPerson(db, "Alex", "1988-03-04");
      await seedPerson(db, "Sam", "1990-11-30");
      // First save: Alex's row, and Sam's cloned from it.
      await caller.retirement.retirementSettings.upsert(settings(alex));
      expect(switches(db).map((r) => r.overlay)).toEqual([false, false]);

      await caller.retirement.retirementSettings.upsert({
        ...settings(alex),
        rothBracketOverlay: true,
      });
      const first = switches(db).find((r) => r.personId === alex)!.profileId!;
      await caller.retirement.retirementProfiles.duplicate({
        sourceProfileId: first,
        name: "Copy",
      });
      // A person added later gets a row in every profile, cloned from the
      // primary's (Alex's, on).
      await caller.people.create({ name: "Kai", dateOfBirth: "2000-01-01" });
      const rows = switches(db);
      expect(rows).toHaveLength(6);
      expect(
        rows.filter((r) => r.personId === alex).map((r) => r.overlay),
      ).toEqual([true, true]);
      expect(rows.every((r) => r.overlay !== null)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("a sent null target turns the overlay off and keeps the stored target", async () => {
    const { caller, db, cleanup } = await createTestCaller();
    try {
      const alex = await seedPerson(db, "Alex", "1988-03-04");
      await caller.retirement.retirementSettings.upsert({
        ...settings(alex),
        rothBracketTarget: "0.22",
        rothBracketOverlay: true,
      });
      await caller.retirement.retirementSettings.upsert({
        ...settings(alex),
        rothBracketTarget: null,
      });
      const [row] = switches(db);
      expect(row!.overlay).toBe(false);
      expect(Number(row!.target)).toBe(0.22);
    } finally {
      await cleanup();
    }
  });

  it("the demo seed writes the switch on every row", async () => {
    const { rawDb, db, sqlite, cleanup } = await createTestCaller();
    try {
      // From empty tables, as a demo schema starts.
      sqlite.pragma("foreign_keys = OFF");
      for (const { name } of sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
        )
        .all() as { name: string }[])
        sqlite.prepare(`DELETE FROM "${name}"`).run();
      sqlite.pragma("foreign_keys = ON");
      await seedProfile(rawDb, DEMO_PROFILES["recently-retired"]!, new Date());
      const rows = switches(db);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.overlay)).toEqual(rows.map(() => false));
    } finally {
      await cleanup();
    }
  });
});
