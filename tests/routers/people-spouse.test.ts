/**
 * people.setSpouse (tag 0024's writer): the pair is stored on both rows,
 * one pair per household (linking replaces an earlier pair and frees the
 * old partners), clearing unlinks both, a self-link or an unknown person is
 * refused, and deleting a spouse unlinks the other.
 */
import "./setup-mocks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestCaller, seedPerson, viewerSession } from "./setup";

type Ctx = Awaited<ReturnType<typeof createTestCaller>>;

describe("people.setSpouse", () => {
  let t: Ctx;
  let ann: number;
  let ben: number;
  let cal: number;

  /** Each person's stored spouse, by name. */
  const links = async () =>
    Object.fromEntries(
      (await t.caller.people.list()).map((p) => [p.name, p.spousePersonId]),
    );

  beforeEach(async () => {
    t = await createTestCaller();
    ann = await seedPerson(t.db, "Ann", "1960-05-01");
    ben = await seedPerson(t.db, "Ben", "1962-08-15");
    cal = await seedPerson(t.db, "Cal", "1990-02-10");
  });
  afterEach(() => t.cleanup());

  it("a new person has no spouse stored", async () => {
    expect(await links()).toEqual({ Ann: null, Ben: null, Cal: null });
  });

  it("stores the pair on both rows", async () => {
    await t.caller.people.setSpouse({ id: ann, spousePersonId: ben });
    expect(await links()).toEqual({ Ann: ben, Ben: ann, Cal: null });
  });

  it("linking again replaces the pair: the old partners are freed", async () => {
    await t.caller.people.setSpouse({ id: ann, spousePersonId: ben });
    await t.caller.people.setSpouse({ id: cal, spousePersonId: ann });
    expect(await links()).toEqual({ Ann: cal, Ben: null, Cal: ann });
  });

  it("clearing from either side unlinks both, and leaves another pair alone", async () => {
    await t.caller.people.setSpouse({ id: ann, spousePersonId: ben });
    await t.caller.people.setSpouse({ id: ben, spousePersonId: null });
    expect(await links()).toEqual({ Ann: null, Ben: null, Cal: null });

    await t.caller.people.setSpouse({ id: ann, spousePersonId: ben });
    await t.caller.people.setSpouse({ id: cal, spousePersonId: null });
    expect(await links()).toEqual({ Ann: ben, Ben: ann, Cal: null });
  });

  it("refuses a self-link and an unknown person, storing nothing", async () => {
    await expect(
      t.caller.people.setSpouse({ id: ann, spousePersonId: ann }),
    ).rejects.toThrow(/own spouse/);
    await expect(
      t.caller.people.setSpouse({ id: ann, spousePersonId: 9_999 }),
    ).rejects.toThrow(/No such person/);
    await expect(
      t.caller.people.setSpouse({ id: 9_999, spousePersonId: null }),
    ).rejects.toThrow(/No such person/);
    expect(await links()).toEqual({ Ann: null, Ben: null, Cal: null });
  });

  it("deleting a spouse unlinks the other", async () => {
    await t.caller.people.setSpouse({ id: cal, spousePersonId: ben });
    await t.caller.people.delete({ id: cal });
    expect(await links()).toEqual({ Ann: null, Ben: null });
  });

  it("is an admin's", async () => {
    const viewer = await createTestCaller(viewerSession);
    try {
      await expect(
        viewer.caller.people.setSpouse({ id: 1, spousePersonId: null }),
      ).rejects.toThrow();
    } finally {
      viewer.cleanup();
    }
  });
});
