/**
 * Directions to another page ("Settings → Integrations", "Portfolio → …")
 * are links (SettingsLink / PortfolioAccountsLink), never plain text that
 * goes stale. Scans .tsx outside comments; the link components and the
 * shared section list build the label themselves and are exempt.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC_ROOT = path.resolve(__dirname, "../../src");
const DIRECTION = /\b(Settings|Portfolio) (→|&gt;)/;
const EXEMPT = new Set([
  "components/ui/settings-link.tsx",
  "components/portfolio/portfolio-accounts-link.tsx",
]);

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".tsx")) yield full;
  }
}

function isComment(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") ||
    t.startsWith("*") ||
    t.startsWith("/*") ||
    t.startsWith("{/*")
  );
}

describe("page directions are links", () => {
  it("no plain-text 'Settings →' / 'Portfolio →' in UI", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = path.relative(SRC_ROOT, file);
      if (EXEMPT.has(rel)) continue;
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (isComment(line) || !DIRECTION.test(line)) return;
          // Text inside a NavLink/Link on the same line is already a link.
          if (
            /<(Nav)?Link\b[^>]*>[^<]*(Settings|Portfolio) (→|&gt;)/.test(line)
          )
            return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
