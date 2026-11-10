/**
 * Owner V6: a `Comments-only:` commit is exempt from the size limits when
 * every `src/` code token is unchanged (the engine hash's codeOf).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checkCommit,
  notCommentsOnly,
  parseMessage,
  parseNumstat,
  type CommitFacts,
} from "../../scripts/check-commit";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" });

const BASE: Record<string, string> = {
  "src/lib/pure/engine/draw.ts": `/** The yearly draw. */
export function draw(balance: number, rate: number): number {
  // Never below zero.
  return Math.max(0, balance * rate);
}
`,
  "src/components/card.tsx": `export function Card({ total }: { total: number }) {
  return (
    <div>
      {/* The total, formatted upstream. */}
      <span>{total}</span>
    </div>
  );
}
`,
  "src/app/styles.css": `/* page */\nbody { margin: 0; }\n`,
  "docs/NOTES.md": "notes\n",
};

const write = (files: Record<string, string>) => {
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
};

/** Stage `files` over the base commit and prove the staged change. */
function prove(files: Record<string, string>, remove: string[] = []) {
  git("reset", "-q", "--hard", "base");
  write(files);
  for (const file of remove) git("rm", "-q", file);
  git("add", "-A");
  return notCommentsOnly(
    parseNumstat(git("diff", "--cached", "-M", "--numstat")),
    git("diff", "--cached", "-M", "-U1000000", "--", "src/"),
  );
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-comments-only-"));
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  write(BASE);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("tag", "base");
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("notCommentsOnly", () => {
  it("passes reworded, added and removed comments, a JSX comment included", () => {
    expect(
      prove({
        "src/lib/pure/engine/draw.ts": `/**
 * The yearly draw, taken at the start of the year.
 * It reads the rate as a fraction.
 */
export function draw(balance: number, rate: number): number {
  return Math.max(0, balance * rate); // floored at zero
}
`,
        "src/components/card.tsx": BASE["src/components/card.tsx"]!.replace(
          "formatted upstream",
          "already formatted",
        ),
        // Outside src/: not part of the proof.
        "docs/NOTES.md": "other notes\n",
      }),
    ).toBeUndefined();
  });

  it("refuses a changed token, a string included", () => {
    expect(
      prove({
        "src/lib/pure/engine/draw.ts": BASE[
          "src/lib/pure/engine/draw.ts"
        ]!.replace("Math.max(0,", "Math.max(1,"),
      }),
    ).toBe("src/lib/pure/engine/draw.ts: code changed, not only comments");
    expect(
      prove({
        "src/components/card.tsx": BASE["src/components/card.tsx"]!.replace(
          "<span>{total}</span>",
          "<span>{total} // total</span>",
        ),
      }),
    ).toBe("src/components/card.tsx: code changed, not only comments");
  });

  it("refuses a re-wrap: codeOf keeps where a line breaks, which can end a statement", () => {
    expect(
      prove({
        "src/lib/pure/engine/draw.ts": BASE[
          "src/lib/pure/engine/draw.ts"
        ]!.replace(
          "Math.max(0, balance * rate)",
          "Math.max(\n    0,\n    balance * rate)",
        ),
      }),
    ).toBe("src/lib/pure/engine/draw.ts: code changed, not only comments");
  });

  it("refuses a file that isn't code, and a created, deleted or moved file", () => {
    expect(
      prove({ "src/app/styles.css": "/* the page */\nbody { margin: 0; }\n" }),
    ).toMatch(/^src\/app\/styles\.css: not code/);
    expect(prove({ "src/lib/new.ts": "// only a comment\n" })).toBe(
      "src/lib/new.ts: a Comments-only: commit creates or deletes no file",
    );
    expect(prove({}, ["src/components/card.tsx"])).toBe(
      "src/components/card.tsx: a Comments-only: commit creates or deletes no file",
    );
    git("reset", "-q", "--hard", "base");
    git("mv", "src/components/card.tsx", "src/components/total-card.tsx");
    expect(
      notCommentsOnly(
        parseNumstat(git("diff", "--cached", "-M", "--numstat")),
        git("diff", "--cached", "-M", "-U1000000", "--", "src/"),
      ),
    ).toMatch(/moves no file$/);
  });
});

describe("checkCommit with Comments-only:", () => {
  const big = Array.from({ length: 9 }, (_, index) => ({
    file:
      index === 0 ? "src/lib/pure/engine/draw.ts" : `src/lib/pure/f${index}.ts`,
    added: 60,
    deleted: 0,
  }));
  const facts = (raw: string, notComments?: string): CommitFacts => ({
    message: parseMessage(raw),
    files: big,
    spots: [],
    priorFixes: new Map(),
    notCommentsOnly: notComments,
  });
  const rules = (f: CommitFacts) => checkCommit(f).map((w) => w.rule);
  const raw =
    "docs: reword the draw comments\n\nThey named a removed helper.\n\nComments-only: comment rewording\n";

  it("exempts a proven commit from the line and engine-file limits", () => {
    expect(rules(facts("docs: x\n\nWhy.\n"))).toEqual(["size", "engine-files"]);
    expect(rules(facts(raw))).toEqual([]);
  });

  it("refuses the exemption when the proof fails", () => {
    expect(
      rules(facts(raw, "src/a.ts: code changed, not only comments")),
    ).toEqual(["comments-only", "size", "engine-files"]);
  });
});
