/**
 * `pnpm seed` (server/services/demo/dev-seed.ts) loads one invented demo
 * household into an empty dev database and refuses one that already holds
 * people, so it never mixes into real data.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestCaller } from "../../../routers/setup";
import { seedDevDatabase } from "@/server/services/demo/dev-seed";

const SEEDED_ON = new Date("2026-03-07T12:00:00");
import { DEMO_PROFILES } from "@/lib/demo";

let harness: Awaited<ReturnType<typeof createTestCaller>>;

beforeEach(async () => {
  harness = await createTestCaller();
});

afterEach(() => {
  harness.cleanup();
});

describe("seedDevDatabase", () => {
  it("loads the named demo household into an empty database", async () => {
    await seedDevDatabase(harness.rawDb, "single-income", SEEDED_ON);
    const people = harness.sqlite.prepare("SELECT name FROM people").all() as {
      name: string;
    }[];
    const expected = DEMO_PROFILES["single-income"]!.people.map((p) => p.name);
    expect(people.map((p) => p.name)).toEqual(expect.arrayContaining(expected));
  });

  it("refuses a database that already holds a household", async () => {
    await seedDevDatabase(harness.rawDb, "single-income", SEEDED_ON);
    await expect(
      seedDevDatabase(harness.rawDb, "debt-payoff", SEEDED_ON),
    ).rejects.toThrow(/already holds a household/);
  });

  it("refuses a household name it doesn't know, naming the ones it does", async () => {
    await expect(
      seedDevDatabase(harness.rawDb, "nobody", SEEDED_ON),
    ).rejects.toThrow(/single-income/);
  });
});
