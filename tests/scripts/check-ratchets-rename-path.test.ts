/**
 * AR9 proof: check-ratchets excuses the size rise a proven `Rename-path:`
 * commit's re-wrap makes (the script records it), and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRatchets } from "../../scripts/check-ratchets";
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
