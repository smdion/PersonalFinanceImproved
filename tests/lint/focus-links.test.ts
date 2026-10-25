/**
 * Links into pages go through the focus table (RULES.md § Links into Pages):
 * senders carry a `Focus`, never a route string; every topic has a target
 * on its home page; a home is never a redirect (it drops the query).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { FOCUS_HOMES } from "@/lib/config/focus-topics";

const SRC = path.resolve(__dirname, "../../src");
const APP = path.join(SRC, "app/(dashboard)");

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

const isComment = (line: string) => /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);

// --- Senders: no route literals ---

/** Where links to other pages are built. */
const SENDERS = [
  "components/cards/dashboard",
  "lib/pure",
  "lib/config/milestones.ts",
  "lib/config/data-sources.ts",
];
/** A link written as data (`href: "/…"`), or a JSX link carrying a query or
 *  hash. A card header's plain `href="/page"` is the card's general link. */
const ROUTE_LITERAL = /href: "\/|href="\/[^"]*[?#]/;
/** Not yet moved to topics — may only shrink (plan: PLAN-deep-links). */
const NOT_YET = new Set([
  "components/cards/dashboard/financial-checkup-card.tsx",
  "lib/config/data-sources.ts",
  "lib/config/milestones.ts",
  "lib/pure/milestones.ts",
  "lib/pure/recommendations-caps.ts",
  "lib/pure/recommendations-cash.ts",
  "lib/pure/recommendations-funds.ts",
  "lib/pure/recommendations-roth.ts",
]);

function senderFiles(): string[] {
  return SENDERS.flatMap((s) => {
    const full = path.join(SRC, s);
    return fs.statSync(full).isDirectory() ? [...walk(full)] : [full];
  });
}

function routeLiterals(file: string): string[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      !isComment(line) && ROUTE_LITERAL.test(line)
        ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`]
        : [],
    );
}

describe("links into pages", () => {
  it("senders build links with focusHref / FocusLink, not route strings", () => {
    const offenders = senderFiles()
      .filter((f) => !NOT_YET.has(path.relative(SRC, f)))
      .flatMap(routeLiterals);
    expect(offenders).toEqual([]);
  });

  it("the not-yet list only holds files that still need moving", () => {
    const stale = [...NOT_YET].filter(
      (rel) => routeLiterals(path.join(SRC, rel)).length === 0,
    );
    expect(stale).toEqual([]);
  });

  // --- Receivers ---

  /** Files a route renders: its page tree plus every `@/` or relative
   *  import, followed transitively. */
  function routeFiles(route: string): string {
    const seen = new Set<string>();
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith("@/")
        ? path.join(SRC, spec.slice(2))
        : spec.startsWith(".")
          ? path.resolve(path.dirname(from), spec)
          : null;
      if (!base) return null;
      for (const c of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
      ])
        if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
      return null;
    };
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/from "([^"]+)"|import\("([^"]+)"\)/g)) {
        const next = resolve(file, m[1] ?? m[2]!);
        if (next) visit(next);
      }
    };
    for (const f of walk(path.join(APP, route.slice(1)))) visit(f);
    return [...seen].map((f) => fs.readFileSync(f, "utf8")).join("\n");
  }

  const topics = Object.entries(FOCUS_HOMES).filter(([, h]) => !h.href);

  it.each(topics)(
    "%s: its home renders a target and reads its state",
    (topic, home) => {
      const code = routeFiles(home.route);
      if (home.target === "section")
        expect(
          new RegExp(
            `topic="${topic}"|useFocus(Match|Reveal)\\("${topic}"\\)`,
          ).test(code),
          `no FocusTarget / useFocusMatch / useFocusReveal for "${topic}" under ${home.route}`,
        ).toBe(true);
      for (const key of Object.keys(home.state ?? {}))
        expect(
          new RegExp(`useFocusedState\\(\\s*"${key}"`).test(code),
          `${home.route} never reads "${key}" with useFocusedState`,
        ).toBe(true);
    },
  );

  it.each(topics)("%s: its home is not a redirect", (_topic, home) => {
    const page = path.join(APP, home.route.slice(1), "page.tsx");
    expect(fs.existsSync(page)).toBe(true);
    expect(
      /export default (async )?function \w+\([^)]*\)\s*\{\s*redirect\(/.test(
        fs.readFileSync(page, "utf8"),
      ),
    ).toBe(false);
  });
});
