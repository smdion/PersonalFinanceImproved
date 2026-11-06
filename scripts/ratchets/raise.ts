/**
 * `Ratchet-raise:` trailers, read per commit and per entry:
 *
 *   Ratchet-raise: <ratchet file> — <entry> +<N>[; <entry> +<N>…], <reason>
 *
 * Each `;`-separated part names entries and a rise: a file path (with
 * `src/` or without), a function, a rule, an export, a route or a list key,
 * and `+N` (or `<name> <a> → <b>`). A `+N` belongs to the path before it,
 * else to the path after it; a part that says "each" gives its `+N` to the
 * paths of the parts after it that have none. Text in parentheses after a
 * space is reason, not entries.
 */
import ts from "typescript";
import { trailerValues } from "../check-commit";
import type { Rise } from "./rise";

export const RAISE = "Ratchet-raise";

/** One entry a trailer names, with the rise it gives (if any). */
export type Claim = { path?: string; n?: number; text: string };

const PATH =
  /(?<![\w./-])(?:[\w@.()[\]-]+\/)*[\w.[\]-]+\.(?:tsx?|jsx?|mjs|cjs|json)(?!\w)/g;
const AMOUNT = /(?<![\w+])\+(\d+)(?!\d)/g;
const ARROW = /([\w/.-]+)\s+(\d+)\s*(?:→|->)\s*(\d+)/g;

/** `<file> — <entries>` → the ratchet files and the entries' claims. */
export function readRaise(
  value: string,
): { files: string[]; claims: Claim[] } | undefined {
  const match = /^(.+?)\s+(?:—|--)\s+(\S.*)$/.exec(value);
  if (!match) return undefined;
  const files = match[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { files, claims: claimsIn(match[2]!) };
}

export function claimsIn(entries: string): Claim[] {
  const claims: Claim[] = [];
  let each: number | undefined;
  for (const text of entries.replace(/\s\([^()]*\)/g, " ").split(";")) {
    const paths = [...text.matchAll(PATH)].map((m) => ({
      at: m.index,
      path: m[0],
      n: undefined as number | undefined,
    }));
    const amounts = [...text.matchAll(AMOUNT)].map((m) => ({
      at: m.index,
      n: Number(m[1]),
    }));
    if (/\beach\b/.test(text) && amounts[0]) each = amounts[0].n;
    const owner = (at: number) => {
      const before = paths.filter((p) => p.at < at).at(-1);
      return before ?? paths.find((p) => p.at > at);
    };
    for (const { at, n } of amounts) {
      const p = owner(at);
      if (p && p.n === undefined) p.n = n;
    }
    for (const m of text.matchAll(ARROW))
      if (!paths.some((p) => p.path === m[1]))
        claims.push({ n: Number(m[3]) - Number(m[2]), text: m[0] });
    for (const p of paths) {
      const arrow = [...text.matchAll(ARROW)].find((m) => m[1] === p.path);
      if (arrow && p.n === undefined) p.n = Number(arrow[3]) - Number(arrow[2]);
    }
    for (const p of paths) claims.push({ path: p.path, n: p.n ?? each, text });
    if (paths.length === 0)
      claims.push({
        n: amounts.length === 1 ? amounts[0]!.n : undefined,
        text,
      });
  }
  return claims;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) =>
  new RegExp(`(?<!\\w)${escape(word)}(?!\\w)`).test(text);

/** Whether a claim names the rise's entry. */
export function names(rise: Rise, claim: Claim): boolean {
  const { paths, names: words } = rise.entry;
  if (
    paths.length > 0 &&
    !paths.some((p) => p === claim.path || p === `src/${claim.path}`)
  )
    return false;
  return words.every((any) => any.some((w) => hasWord(claim.text, w)));
}

export type Verdict =
  { ok: true; trailer: string } | { ok: false; why: string };

/** Body lines `- <path> <a> -> <b>`: the list a trailer naming no entry points to. */
const BODY_ENTRY = /^- (\S+) (\d+) (?:→|->) (\d+)\b/;

function bodyClaims(message: string): Claim[] {
  return message
    .split("\n")
    .filter((line) => BODY_ENTRY.test(line))
    .flatMap((line) => claimsIn(line.slice(2)));
}

/**
 * A rise is excused by the claims of this commit's trailers that name it. A
 * trailer that names no entry reads the body's `- <path> <a> -> <b>` list.
 */
export function excuse(rise: Rise, message: string): Verdict {
  const trailers: string[] = [];
  let total = 0;
  let named = false;
  for (const value of trailerValues(message, RAISE)) {
    const raise = readRaise(value);
    if (!raise?.files.includes(rise.file)) continue;
    const vague = raise.claims.every((c) => !c.path && c.n === undefined);
    const claims = vague ? bodyClaims(message) : raise.claims;
    const hits = claims.filter((c) => names(rise, c));
    if (hits.length === 0) continue;
    named = true;
    trailers.push(`${RAISE}: ${value}`);
    total += hits.reduce((sum, c) => sum + (c.n ?? 0), 0);
  }
  if (!named)
    return {
      ok: false,
      why: `no ${RAISE} trailer in this commit names the entry`,
    };
  if (rise.by !== undefined && total < rise.by)
    return {
      ok: false,
      why: `its ${RAISE} trailer gives +${total}, the entry rose +${rise.by}`,
    };
  return { ok: true, trailer: trailers.join(" | ") };
}

/**
 * Lines of import statements (and `export … from`) in a source file, and
 * the lines past its first that each type holding an `import("…")` spans.
 */
export function importLines(
  file: string,
  text: string | undefined,
): { statements: number; types: number } {
  const lines = { statements: 0, types: 0 };
  if (text === undefined || !/\.(?:tsx?|jsx?|mjs|cjs)$/.test(file))
    return lines;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const span = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getEnd()).line -
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  for (const stmt of sf.statements)
    if (
      ts.isImportDeclaration(stmt) ||
      ts.isImportEqualsDeclaration(stmt) ||
      (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier)
    )
      lines.statements += span(stmt) + 1;
  const hasImportType = (node: ts.Node): boolean =>
    ts.isImportTypeNode(node) || ts.forEachChild(node, hasImportType) === true;
  const visit = (node: ts.Node) => {
    if (ts.isTypeNode(node) && hasImportType(node)) lines.types += span(node);
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}
