/**
 * Every query, and every mutation that does more than its name says, has a
 * doc comment: docs/API_ROUTERS.md prints it as the procedure's Description.
 * The count without one is scripts/ratchets/undocumented-procedures.json; it
 * only falls (check:ratchets holds it), lowered in the commit that documents.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRouterCatalog } from "../../scripts/gen-api-docs";
import {
  UNDOCUMENTED_FILE,
  undocumentedRises,
  type Undocumented,
} from "../../scripts/ratchets/counts";
import { excuse } from "../../scripts/ratchets/raise";

const ROOT = path.resolve(__dirname, "../..");
const ROUTERS = path.join(ROOT, "src/server/routers");

describe("procedure doc comments", () => {
  const procedures = readRouterCatalog(ROUTERS);
  const undocumented = procedures
    .filter((p) => p.description === "")
    .map((p) => p.path);
  const recorded = (
    JSON.parse(
      fs.readFileSync(path.join(ROOT, UNDOCUMENTED_FILE), "utf8"),
    ) as Undocumented
  ).procedures;

  it("reads the mounted router", () => {
    expect(procedures.length).toBeGreaterThan(100);
  });

  it("adds no procedure without a doc comment", () => {
    expect(
      undocumented.length,
      `${undocumented.length} procedures have no doc comment, ${recorded} recorded in ${UNDOCUMENTED_FILE}: document the new one (a /** … */ line above it)`,
    ).toBeLessThanOrEqual(recorded);
  });

  it("records the count once it falls", () => {
    expect(
      undocumented.length,
      `${undocumented.length} procedures have no doc comment: lower ${UNDOCUMENTED_FILE} to it in this commit`,
    ).toBeGreaterThanOrEqual(recorded);
  });
});

describe("undocumentedRises", () => {
  const base = { procedures: 40 };

  it("passes the same or a lower count and a new file", () => {
    expect(undocumentedRises(base, base)).toEqual([]);
    expect(undocumentedRises(base, { procedures: 39 })).toEqual([]);
    expect(undocumentedRises(undefined, base)).toEqual([]);
  });

  it("fails a rise, excused only by a trailer naming it with its +N", () => {
    const [rise] = undocumentedRises(base, { procedures: 42 });
    expect([rise?.text, rise?.by]).toEqual([
      "procedures without a doc comment: 42, 40 at the base",
      2,
    ]);
    const message = (value: string) =>
      `refactor: x\n\nWhy.\n\nRatchet-raise: ${UNDOCUMENTED_FILE} — ${value}\n`;
    expect(excuse(rise!, message("procedures +2, owner OK"))).toMatchObject({
      ok: true,
    });
    expect(excuse(rise!, message("procedures +1, owner OK"))).toMatchObject({
      ok: false,
    });
  });
});
