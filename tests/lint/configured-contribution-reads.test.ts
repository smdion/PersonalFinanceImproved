/**
 * Client code figures contribution money from `computeValue()` (the
 * IRS-capped value when the cap pass set one), never from the configured
 * `contributionValue` — that's for editors, saves and diffs
 * (lib/pure/contribution-caps.ts). A total built from the configured value
 * shows money the cap already cut.
 *
 * Binding an input to `contributionValue` is fine; turning it into a
 * number is where a display figure goes wrong. Every such read in
 * components, pages and hooks is listed here with why it's an editor's
 * read. A new one fails this test: use `computeValue(c)`, or add it here
 * if it really is about the configured setting.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT_DIRS = ["src/components", "src/app", "src/lib/hooks"];

/** file → number of numeric reads of the configured value, and why. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "src/components/paycheck/contrib-card.tsx": {
    count: 1,
    why: "auto-max preview: today's setting vs the most it can be",
  },
  "src/app/(dashboard)/budget/what-if-tab.tsx": {
    count: 1,
    why: "the What-If sandbox: which contribution edits are non-zero",
  },
  "src/app/(dashboard)/budget/what-if-editors.tsx": {
    count: 1,
    why: "the What-If editor: the live value a row's edit starts from",
  },
};

const NUMERIC_READ =
  /\b(?:Number|parseFloat|toNumber)\(\s*[\w.?!\]]*\.contributionValue\b/g;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

describe("client contribution money reads computeValue, not the configured value", () => {
  it("numeric reads of contributionValue are only the listed editor reads", () => {
    const found: Record<string, number> = {};
    for (const dir of CLIENT_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const n = (fs.readFileSync(file, "utf8").match(NUMERIC_READ) ?? [])
          .length;
        if (n > 0) found[path.relative(ROOT, file)] = n;
      }
    }
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED).map(([f, a]) => [f, a.count]),
    );
    expect(found).toEqual(allowed);
  });
});
