import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JSCPD_CONFIG,
  countsOf,
  describeClones,
  judge,
  type Clone,
} from "../../scripts/check-duplicates";
import { duplicateRises } from "../../scripts/ratchets/counts";
import { excuse } from "../../scripts/ratchets/raise";

const clone = (lines: number, a: string, b: string): Clone => ({
  lines,
  firstFile: { name: a, start: 1, end: lines },
  secondFile: { name: b, start: 10, end: 9 + lines },
});

describe("check-duplicates", () => {
  const recorded = { blocks: 32, lines: 757 };

  it("passes the recorded counts", () => {
    expect(judge(recorded, recorded).ok).toBe(true);
  });

  it("fails a planted copy", () => {
    const verdict = judge(recorded, { blocks: 33, lines: 786 });
    expect(verdict.ok).toBe(false);
    expect(verdict.update).toBeUndefined();
    expect(verdict.messages[0]).toBe(
      "Copied code rose (blocks: 33, 32 recorded; lines: 786, 757 recorded).",
    );
  });

  it("fails a longer copy at the same block count", () => {
    expect(judge(recorded, { blocks: 32, lines: 760 }).ok).toBe(false);
  });

  it("asks for --update when a copy is deleted, and --update lowers", () => {
    const fewer = { blocks: 31, lines: 728 };
    const verdict = judge(recorded, fewer);
    expect(verdict.ok).toBe(false);
    expect(verdict.update).toEqual(fewer);
  });

  it("reads jscpd's totals and lists the blocks longest first", () => {
    const duplicates = [clone(9, "a.ts", "b.ts"), clone(30, "c.ts", "d.tsx")];
    expect(
      countsOf({
        duplicates,
        statistics: { total: { clones: 2, duplicatedLines: 39 } },
      }),
    ).toEqual({ blocks: 2, lines: 39 });
    expect(describeClones(duplicates)).toEqual([
      "  30 lines: src/c.ts:1-30 = src/d.tsx:10-39",
      "  9 lines: src/a.ts:1-9 = src/b.ts:10-18",
    ]);
  });

  it("leaves out generated files, tax data and the schema folders at 100 tokens", () => {
    const config = JSON.parse(readFileSync(JSCPD_CONFIG, "utf8")) as {
      ignore: string[];
      minTokens: number;
    };
    expect(config.minTokens).toBe(100);
    expect(config.ignore).toEqual(
      expect.arrayContaining([
        "src/lib/generated/**",
        "src/lib/tax-data/**",
        "src/lib/db/pg/**",
        "src/lib/db/sqlite/**",
      ]),
    );
  });
});

describe("duplicateRises", () => {
  const base = { blocks: 32, lines: 757 };

  it("passes the same or lower counts and a new file", () => {
    expect(duplicateRises(base, base)).toEqual([]);
    expect(duplicateRises(base, { blocks: 30, lines: 700 })).toEqual([]);
    expect(duplicateRises(undefined, base)).toEqual([]);
  });

  it("names each total that rose", () => {
    expect(
      duplicateRises(base, { blocks: 33, lines: 790 }).map((r) => [
        r.text,
        r.by,
      ]),
    ).toEqual([
      ["copied blocks: 33, 32 at the base", 1],
      ["copied lines: 790, 757 at the base", 33],
    ]);
  });

  it("is excused by the trailer the failure prints", () => {
    const [blocks] = duplicateRises(base, { blocks: 33, lines: 757 });
    const message = (value: string) =>
      `refactor: x\n\nWhy.\n\nRatchet-raise: ${value}\n`;
    expect(
      excuse(
        blocks!,
        message("scripts/ratchets/duplicates.json — blocks +1, owner OK"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      excuse(
        blocks!,
        message("scripts/ratchets/duplicates.json — lines +1, owner OK"),
      ),
    ).toMatchObject({ ok: false });
  });
});
