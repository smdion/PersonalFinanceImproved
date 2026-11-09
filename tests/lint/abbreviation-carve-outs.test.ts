/**
 * ratchet/no-abbreviation's carve-outs are the stored, external and response
 * keys of today's tree: scripts/abbreviation-carve-outs.json is regenerated
 * and compared, so a new stored key is carved out and a gone one drops out.
 * Response keys are every key a router's output type reaches, so the rename
 * proof refuses one that no baseline pin holds.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARVE_OUT_FILE,
  abbreviationCarveOuts,
  isShapeFile,
  storedAndResponseKeys,
} from "../../scripts/gen-abbreviation-carve-outs";
import { notARename, parseNumstat } from "../../scripts/check-commit";

const ROOT = path.resolve(__dirname, "../..");
// Building the program for the router output types takes a while.
const SLOW = 120_000;

describe("abbreviation carve-outs", () => {
  it(
    "match the shapes they are generated from",
    () => {
      const committed: unknown = JSON.parse(
        fs.readFileSync(path.join(ROOT, CARVE_OUT_FILE), "utf8"),
      );
      expect(committed).toEqual(abbreviationCarveOuts(ROOT));
    },
    SLOW,
  );

  it(
    "hold schema, response and external API keys",
    () => {
      const names = abbreviationCarveOuts(ROOT);
      for (const name of ["employerMaxMatchPct", "mcResult", "transfer_acct"])
        expect(names).toContain(name);
    },
    SLOW,
  );

  it(
    "hold router output keys no baseline pin holds",
    () => {
      const names = abbreviationCarveOuts(ROOT);
      for (const name of [
        "returnPct",
        "perfReturnPct",
        "deltaPct",
        "targetPct",
        "yoyCostPct",
        "latestYoyCostPct",
      ])
        expect(names).toContain(name);
      // Router and procedure names are routes, not answer keys.
      expect(names).not.toContain("listContribAccountsForLinking");
    },
    SLOW,
  );

  it(
    "make the rename proof refuse a router output key",
    () => {
      const file = "src/lib/pure/investments/x.ts";
      const row = (k: string) =>
        `export function row(r: R) {\n  return { year: r.year, ${k}: r.rate };\n}`;
      const diff =
        `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n` +
        [
          ...row("returnPct")
            .split("\n")
            .map((l) => `-${l}`),
          ...row("returnPercent")
            .split("\n")
            .map((l) => `+${l}`),
        ].join("\n");
      expect(
        notARename(
          parseNumstat(`1\t1\t${file}`),
          diff,
          "refactor: x\n\nWhy.\n\nMechanical: rename\nRename: returnPct → returnPercent\n",
          { keys: storedAndResponseKeys(ROOT), isShapeFile },
        ),
      ).toBe(
        `${file}:2: returnPct as a key: returnPct is a stored, external or response key (scripts/gen-abbreviation-carve-outs.ts reads them)`,
      );
    },
    SLOW,
  );
});
