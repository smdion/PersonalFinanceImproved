/**
 * ratchet/no-abbreviation's carve-outs are the stored, external and response
 * keys of today's tree: scripts/abbreviation-carve-outs.json is regenerated
 * and compared, so a new stored key is carved out and a gone one drops out.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARVE_OUT_FILE,
  abbreviationCarveOuts,
} from "../../scripts/gen-abbreviation-carve-outs";

const ROOT = path.resolve(__dirname, "../..");

describe("abbreviation carve-outs", () => {
  it("match the shapes they are generated from", () => {
    const committed: unknown = JSON.parse(
      fs.readFileSync(path.join(ROOT, CARVE_OUT_FILE), "utf8"),
    );
    expect(committed).toEqual(abbreviationCarveOuts(ROOT));
  });

  it("hold schema, response and external API keys", () => {
    const names = abbreviationCarveOuts(ROOT);
    for (const name of ["employerMaxMatchPct", "mcResult", "transfer_acct"])
      expect(names).toContain(name);
  });
});
