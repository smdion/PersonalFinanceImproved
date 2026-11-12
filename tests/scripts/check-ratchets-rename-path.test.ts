/**
 * AR9 proof: check-ratchets excuses the size rise a proven `Rename-path:`
 * commit's re-wrap makes (the script records it) and a known-list key its
 * pairs rename with the value kept, and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRatchets } from "../../scripts/check-ratchets";
import { renamedListEntry } from "../../scripts/ratchets/rename-path";
import {
  RENAME_MESSAGE,
  makeFixture,
  type Fixture,
} from "./rename-trpc-path-fixture";

describe("check-ratchets on a Rename-path: commit", () => {
  let f: Fixture;
  let base: string;
  beforeEach(() => {
    f = makeFixture();
    base = f.git("rev-parse", "HEAD");
    f.rename();
    // The re-wrap raised the client's recorded size.
    expect(f.git("diff", "--stat", "size-baseline.json")).toContain(
      "size-baseline.json",
    );
  }, 120_000);
  afterEach(() => f.remove());

  it("excuses the rise when check-commit proves the commit", () => {
    f.git("add", "-A");
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    const { failures, excused } = checkRatchets(base, "HEAD", f.dir);
    expect(failures).toEqual([]);
    expect(excused).toHaveLength(1);
    expect(excused[0]).toMatch(
      /src\/components\/gadget-list\.tsx.*by the proven "Rename-path:"/,
    );
  }, 120_000);

  it("refuses it when a hand edit breaks the proof", () => {
    fs.appendFileSync(path.join(f.dir, "docs/GADGETS.md"), "By hand.\n");
    f.git("add", "-A");
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    const { failures } = checkRatchets(base, "HEAD", f.dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(
      /a Rename-path: commit check-commit doesn't prove \(.*differing paths: docs\/GADGETS\.md\)/,
    );
  }, 120_000);

  it("leaves a commit without Rename-path: to the usual rule", () => {
    f.git("add", "-A");
    const withoutProof = RENAME_MESSAGE.replace(/^Rename-path: .*\n/m, "");
    f.git("commit", "-q", "-m", withoutProof);
    const { failures } = checkRatchets(base, "HEAD", f.dir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/no Ratchet-raise trailer/);
  }, 120_000);
});

const LIST_FILE = "tests/baseline/router-baseline-postgres.test.ts";
const LIST = `const KNOWN_GAPS: Record<string, string[]> = {
  "*/gadgets.listContribRows": ["unordered"],
};
const COUNTS_KNOWN: Record<string, { count: number }> = {
  "gadgets.listContribRows": { count: 2 },
};
export default [KNOWN_GAPS, COUNTS_KNOWN];
`;
const addedRise = (entry: string) => ({
  file: LIST_FILE,
  id: `${LIST_FILE}\0${entry}`,
  text: `${entry}: added`,
  entry: { paths: [], names: [] },
});
const PAIRS = [
  ["gadgets.listContribRows", "gadgets.listContributionRows"],
] as const;
const renamedList = LIST.replaceAll("listContribRows", "listContributionRows");

describe("renamedListEntry", () => {
  it("matches a key the pairs rename, value kept", () => {
    expect(
      renamedListEntry(
        addedRise("KNOWN_GAPS › */gadgets.listContributionRows"),
        PAIRS,
        LIST,
        renamedList,
      ),
    ).toBe("KNOWN_GAPS › */gadgets.listContribRows");
    expect(
      renamedListEntry(
        addedRise("KNOWN_GAPS › */gadgets.listContributionRows › unordered"),
        PAIRS,
        LIST,
        renamedList,
      ),
    ).toBe("KNOWN_GAPS › */gadgets.listContribRows › unordered");
  });

  it("refuses a count that rises, a changed value and an unrelated entry", () => {
    const raised = renamedList.replace("count: 2", "count: 3");
    expect(
      renamedListEntry(
        addedRise("COUNTS_KNOWN › gadgets.listContributionRows"),
        PAIRS,
        LIST,
        raised,
      ),
    ).toBeUndefined();
    const widened = renamedList.replace('["unordered"]', '["unordered", "x"]');
    expect(
      renamedListEntry(
        addedRise("KNOWN_GAPS › */gadgets.listContributionRows"),
        PAIRS,
        LIST,
        widened,
      ),
    ).toBeUndefined();
    const other = renamedList.replace(
      "};\nconst COUNTS",
      '  "*/gadgets.computeTotal": ["unordered"],\n};\nconst COUNTS',
    );
    expect(
      renamedListEntry(
        addedRise("KNOWN_GAPS › */gadgets.computeTotal"),
        PAIRS,
        LIST,
        other,
      ),
    ).toBeUndefined();
  });
});

describe("check-ratchets on a Rename-path: commit that renames a known-list key", () => {
  let f: Fixture;
  let base: string;
  beforeEach(() => {
    f = makeFixture();
    fs.writeFileSync(path.join(f.dir, LIST_FILE), LIST);
    f.git("add", "-A");
    f.git("commit", "-q", "-m", "test: a known list\n\nWhy.");
    base = f.git("rev-parse", "HEAD");
  });
  afterEach(() => f.remove());

  const commitRun = (message: string) => {
    f.rename(message);
    f.git("add", "-A");
    f.git("commit", "-q", "-m", message);
    return checkRatchets(base, "HEAD", f.dir);
  };
  /** A Rename-path-edit line on the list file: part of the proven map. */
  const withEdit = (from: string, to: string) =>
    RENAME_MESSAGE.replace(
      /^(Rename-path: .*)$/m,
      `$1\nRename-path-edit: ${LIST_FILE} ${JSON.stringify(from)} → ${JSON.stringify(to)}`,
    );

  it("excuses the renamed key and its child when proven", () => {
    const { failures, excused } = commitRun(RENAME_MESSAGE);
    expect(failures).toEqual([]);
    expect(excused.filter((e) => e.includes("value kept"))).toHaveLength(3);
    expect(f.read(LIST_FILE)).toBe(renamedList);
  }, 120_000);

  it("fails a renamed key whose count rises, though the commit is proven", () => {
    const { failures } = commitRun(withEdit("{ count: 2 }", "{ count: 3 }"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(
      /COUNTS_KNOWN › gadgets\.listContributionRows: added.*no Ratchet-raise/,
    );
  }, 120_000);

  it("fails an unrelated new entry in a proven commit", () => {
    const { failures } = commitRun(
      withEdit(
        '  "*/gadgets.listContribRows": ["unordered"],\n',
        '  "*/gadgets.listContribRows": ["unordered"],\n  "*/gadgets.computeTotal": ["unordered"],\n',
      ),
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toMatch(/\*\/gadgets\.computeTotal: added/);
    expect(failures.join("\n")).not.toMatch(/listContributionRows/);
  }, 120_000);

  it("fails the renamed key without a proof", () => {
    f.rename();
    fs.appendFileSync(path.join(f.dir, "docs/GADGETS.md"), "By hand.\n");
    f.git("add", "-A");
    f.git("commit", "-q", "-m", RENAME_MESSAGE);
    const { failures } = checkRatchets(base, "HEAD", f.dir);
    expect(failures.join("\n")).toMatch(
      /KNOWN_GAPS › \*\/gadgets\.listContributionRows: added.*doesn't prove/,
    );
  }, 120_000);
});
