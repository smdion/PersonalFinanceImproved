/**
 * scripts/deploy.sh prunes build leftovers after a deploy, and the
 * no-migration rollback retags the previous ledgr:<version>. So every prune
 * it runs must be one that can't remove a tagged image: dangling images
 * (`docker image prune` without -a) and build cache only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const deploy = readFileSync("scripts/deploy.sh", "utf8");
const commands = deploy
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"));
const prunes = commands.filter((line) => /\bprune\b/.test(line));

describe("deploy.sh pruning", () => {
  it("prunes dangling images and build cache", () => {
    expect(prunes.some((l) => /docker image prune -f"/.test(l))).toBe(true);
    expect(prunes.some((l) => /docker builder prune -f"/.test(l))).toBe(true);
  });

  it("never runs a prune that can remove a tagged image", () => {
    for (const line of prunes) {
      expect(line, line).not.toMatch(/\s(-a|--all)\b/);
      expect(line, line).not.toMatch(/system prune|volume prune/);
      expect(line, line).not.toMatch(/--filter/);
    }
  });

  it("removes old tags only below the newest one it keeps", () => {
    // Current and latest are excluded as whole tags (fixed strings, so a
    // version's dots aren't wildcards); `head -n -1` keeps the highest
    // remaining tag, the previous version.
    expect(deploy).toMatch(
      /grep -v -x -F '\$VERSION' \| grep -v -x -F 'latest' \| grep -v -x -F '<none>' \| sort -V \| head -n -1/,
    );
  });
});
