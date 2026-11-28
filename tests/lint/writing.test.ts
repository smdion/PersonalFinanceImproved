/**
 * RULES § Writing, counted: sentences over 25 words, and "should" or "may"
 * used as a modal, in the docs a contributor writes. Both counts live in
 * scripts/ratchets/writing.json; they only fall (check:ratchets holds them).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WRITING_FILE, type Writing } from "../../scripts/ratchets/counts";

const ROOT = path.resolve(__dirname, "../..");
const LIMIT = 25;
/** "May 1" is a date, not a modal. */
const MODAL = /\b(?:[Ss]hould|[Mm]ay)\b(?!\s+\d)/g;
/** Changelogs record history; SCHEMA.md and API_ROUTERS.md are generated. */
const SKIPPED = /^(CHANGELOG|SCHEMA|API_ROUTERS)/;

/**
 * Prose sentences: code, quotes, RULES' guards, fenced blocks, tables,
 * headings and link URLs aside.
 */
function sentences(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph
      .join(" ")
      .replace(/`[^`]*`|"[^"]{0,80}"|“[^”]{0,80}”/g, "X")
      .replace(/\]\([^)]*\)/g, "]")
      .replace(/\[(?:lint|test|check|type|human)\b[^\]]*\]/g, " ")
      .replace(/<!--.*?-->/g, " ")
      .replace(/[*_]{1,2}/g, "");
    paragraph = [];
    for (const s of text.split(/(?<=[.!?])\s+(?=[^a-z\s])/))
      if (s.trim()) out.push(s.trim());
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const skip = /^\s*(#|\||$)/.test(line);
    if (skip || /^\s*([-*+]|\d+\.)\s/.test(line)) flush();
    if (!skip) paragraph.push(line.replace(/^\s*(>\s*)?([-*+]|\d+\.)?\s*/, ""));
  }
  flush();
  return out;
}

const words = (s: string) =>
  s.split(/\s+/).filter((w) => /[\p{L}\p{N}$]/u.test(w)).length;

function countWriting(markdown: string): Writing {
  const all = sentences(markdown);
  return {
    longSentences: all.filter((s) => words(s) > LIMIT).length,
    modals: all.reduce((n, s) => n + (s.match(MODAL)?.length ?? 0), 0),
  };
}

describe("RULES § Writing counts", () => {
  const files = [
    ...fs
      .readdirSync(path.join(ROOT, "docs"))
      .filter((f) => f.endsWith(".md") && !SKIPPED.test(f))
      .map((f) => `docs/${f}`),
    "CONTRIBUTING.md",
    "CLAUDE.md",
  ];
  const found: Writing = { longSentences: 0, modals: 0 };
  for (const file of files) {
    const counts = countWriting(fs.readFileSync(path.join(ROOT, file), "utf8"));
    found.longSentences += counts.longSentences;
    found.modals += counts.modals;
  }
  const recorded = JSON.parse(
    fs.readFileSync(path.join(ROOT, WRITING_FILE), "utf8"),
  ) as Writing;

  it.each(["longSentences", "modals"] as const)("%s doesn't rise", (key) => {
    expect(
      found[key],
      `${key}: ${found[key]}, ${recorded[key]} recorded in ${WRITING_FILE}: rewrite the new text (RULES § Writing)`,
    ).toBeLessThanOrEqual(recorded[key]);
  });

  it.each(["longSentences", "modals"] as const)(
    "%s is recorded once it falls",
    (key) => {
      expect(
        found[key],
        `${key}: ${found[key]}: lower ${WRITING_FILE} to it in this commit`,
      ).toBeGreaterThanOrEqual(recorded[key]);
    },
  );
});

describe("countWriting", () => {
  it("counts prose only", () => {
    const long = Array.from({ length: 26 }, () => "word").join(" ");
    const text = [
      "# A heading that should not count",
      "",
      `${long}. A short one may pass.`,
      "",
      "- A list item should count. It ends on May 1.",
      "",
      "| a table row that should not count |",
      "",
      "```",
      "code that should not count",
      "```",
      "",
      'Text with `should` in code, "may" quoted and [a link](https://x.test/may).',
    ].join("\n");
    expect(countWriting(text)).toEqual({ longSentences: 1, modals: 2 });
  });
});
