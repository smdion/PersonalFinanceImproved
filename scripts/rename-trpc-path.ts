#!/usr/bin/env tsx
/**
 * Renames tRPC procedure paths (AR9's codemod; owner "AR9 proof", 2026-11-11).
 * A commit made by it carries its map as trailers, and check-commit proves
 * it by re-running this script on the commit's parent (CONTRIBUTING § Commit
 * rules, `Rename-path:`).
 *
 *   tsx scripts/rename-trpc-path.ts --message <msg.txt> [--root <worktree>]
 *       [--dry-run] [--no-post] [--report <file.json>]
 *   tsx scripts/rename-trpc-path.ts --map <map.json> --area <id> [--print-trailers] …
 *
 * The map, from the message's trailers (check-commit's readRenamePaths):
 *   Rename-path: <old.path> → <new.path>      old prefix → new prefix
 *   Rename-path-move: <old file> → <new file>  git mv, imports follow
 *   Rename-path-edit: <file> <JSON from> → <JSON to>   one literal edit
 *   Rename-path-delete: <file>
 * or from a map.json area ({ id, paths, moves, routerEdits, delete });
 * `--print-trailers` prints that area as the trailer lines.
 * A prefix is a namespace or a whole procedure path; every procedure under
 * it (read from the router as mounted, by scripts/gen-api-docs.ts's reader)
 * is renamed. Procedure paths that are only leaf renames (same parent) and
 * root-namespace renames are edited in the router automatically; anything
 * that moves a procedure to another parent goes through edits (literal,
 * idempotent: skipped when `to` is there and `from` isn't).
 *
 * What it rewrites, in the worktree (git ls-files; never CHANGELOG.md,
 * drizzle*, .scratch, node_modules, src/lib/generated):
 *   - code (.ts/.tsx/.js/.mjs/.cjs), by syntax tree, never by plain text:
 *     property-access chains (`trpc.networth.computeSummary.useQuery`,
 *     `utils.networth.invalidate()`, `ctx.caller.networth...`), indexed
 *     types (`RouterOutputs["networth"]["listSnapshots"]`), object-literal
 *     keys of mocks (`{ networth: { computeSummary: … } }`), string
 *     literals and template text holding a path (`"networth.computeSummary"`,
 *     `"networth.invalidate"`, `/api/trpc/networth.computeSummary`), and
 *     comments naming a whole path;
 *   - JSON string tokens (baseline text keys, frozen-backup digests);
 *   - Markdown inline code spans and /api/trpc/ URLs (docs, not CHANGELOG);
 *   - shell /api/trpc/ URLs;
 *   - baseline files named by path (`__baseline__/<h>/<path>[variant].json`),
 *     renamed with git mv (bytes unchanged);
 *   - tests/lint/procedure-verbs.test.ts: an OFF_PREFIX_KNOWN entry whose new
 *     name starts with a read verb is deleted, not renamed.
 * A namespace alone (`networth`) is matched only when a tRPC utility method
 * follows (`.invalidate`, `.refetch`, …), or as a whole string, or right
 * after a known tRPC root (`trpc`, `utils`, `caller`, …): page routes
 * (`/networth`), storage keys (`networth_view_mode`) and folder names stay.
 *
 * Afterwards (unless --no-post): prettier on the changed files, then the
 * generated docs: scripts/gen-api-docs.ts (docs/API_ROUTERS.md), and
 * scripts/verify-docs.ts --update (DESIGN's AUTO-GEN counts, then prettier
 * on DESIGN, as a count can widen a table cell); a
 * recorded size the re-wrap raised is recorded at its size
 * (check-size-baseline.ts --raise-renamed), then sizes that fell are lowered.
 *
 * Idempotent: the procedure list is read from the router as it stands; a
 * path already renamed is found under its new name and mapped back, every
 * rewrite only matches old names, and the abbreviation counts compare each
 * file with its text before this run (not HEAD), so a second run, committed
 * or not, changes nothing.
 * Used on a landing conflict: check out the landed side, re-run the area.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  readRenamePaths,
  renamePathTrailers,
  type RenamePathMap,
} from "./check-commit";
import { readRouterCatalog } from "./gen-api-docs";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const USAGE =
  "usage: rename-trpc-path.ts [--root <worktree>] (--message <file> | --map <map.json> --area <id>) [--print-trailers] [--dry-run] [--no-post] [--report <file>]";

type MapArea = {
  id: string;
  paths: [string, string][];
  moves?: [string, string][];
  routerEdits?: { file: string; from: string; to: string }[];
  delete?: string[];
};

/** A map.json area as the trailer map (moves, edits and deletes in order). */
export function mapOfArea(a: MapArea): RenamePathMap {
  return {
    paths: a.paths,
    moves: a.moves ?? [],
    edits: a.routerEdits ?? [],
    deletes: a.delete ?? [],
  };
}

let ROOT = process.cwd();
let DRY = false;
let POST = true;
let area: RenamePathMap & { id: string } = {
  id: "",
  paths: [],
  moves: [],
  edits: [],
  deletes: [],
};

const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
const abs = (r: string) => path.join(ROOT, r);

const report = {
  area: "",
  procedures: [] as { from: string; to: string }[],
  files: {} as Record<string, number>,
  baselineRenames: [] as { from: string; to: string }[],
  moves: [] as { from: string; to: string }[],
  routerEdits: [] as string[],
  rootIdentifierMatches: [] as string[],
  manual: [] as string[],
  offPrefixDropped: [] as string[],
  sizeRaised: [] as string[],
};
const note = (file: string) =>
  (report.files[file] = (report.files[file] ?? 0) + 1);

/** A file of this tree, not a symlink (never written through). */
const plainFile = (file: string) =>
  fs.existsSync(abs(file)) && !fs.lstatSync(abs(file)).isSymbolicLink();

/**
 * Each file's text before this run touched it (the first read wins), so a
 * step that compares old with new (the abbreviation counts) reads this run's
 * own change, never HEAD: a second run on an uncommitted tree is a no-op.
 */
const ORIGINAL = new Map<string, string>();
const remember = (file: string) => {
  if (ORIGINAL.has(file) || !fs.existsSync(abs(file))) return;
  if (fs.statSync(abs(file)).isDirectory()) return;
  ORIGINAL.set(file, fs.readFileSync(abs(file), "utf8"));
};

// ---------------------------------------------------------------------------
// The procedure map, from the router as it stands (old or new names)
// ---------------------------------------------------------------------------

type Entry = { path: string; source: string; kind: "query" | "mutation" };

function readCatalog(): Entry[] {
  return readRouterCatalog(abs("src/server/routers")) as Entry[];
}

const under = (p: string, prefix: string) =>
  p === prefix || p.startsWith(`${prefix}.`);
const swap = (p: string, from: string, to: string) => to + p.slice(from.length);

/** old procedure path → new, and old router-node path → new. */
function buildMaps(catalog: Entry[]) {
  const proc = new Map<string, string>();
  for (const [from, to] of area.paths) {
    let found = 0;
    for (const e of catalog) {
      if (under(e.path, from)) {
        proc.set(e.path, swap(e.path, from, to));
        found++;
      } else if (
        under(e.path, to) &&
        !catalog.some((c) => under(c.path, from))
      ) {
        // Already renamed: map back from the new name.
        proc.set(swap(e.path, to, from), e.path);
        found++;
      }
    }
    if (found === 0) report.manual.push(`no procedure under ${from} or ${to}`);
  }
  const node = new Map<string, string>();
  for (const [o, n] of proc) {
    const os = o.split("."),
      ns = n.split(".");
    // Each namespace above the procedure, while the two paths still line up
    // from the end (the part that moved is the prefix).
    for (let k = 1; k < os.length; k++) {
      const oNode = os.slice(0, k).join(".");
      const tail = os.slice(k);
      const nTail = ns.slice(ns.length - tail.length);
      if (tail.join(".") !== nTail.join(".")) continue;
      const nNode = ns.slice(0, ns.length - tail.length).join(".");
      if (oNode !== nNode && area.paths.some(([f]) => under(oNode, f)))
        node.set(oNode, nNode);
    }
  }
  return { proc, node };
}

// ---------------------------------------------------------------------------
// Matching a sequence of names against the map
// ---------------------------------------------------------------------------

/** tRPC client / React Query utility members that follow a path. */
const UTILS = new Set([
  "invalidate",
  "refetch",
  "cancel",
  "reset",
  "fetch",
  "prefetch",
  "ensureData",
  "getData",
  "setData",
  "getInfiniteData",
  "setInfiniteData",
  "fetchInfinite",
  "prefetchInfinite",
  "useQuery",
  "useSuspenseQuery",
  "useMutation",
  "useInfiniteQuery",
  "useSuspenseInfiniteQuery",
  "query",
  "mutate",
  "mutation",
  "queryOptions",
  "mutationOptions",
  "queryKey",
  "pathKey",
  "useQueries",
]);
/** Names a tRPC proxy is commonly held in. */
const ROOTS = new Set([
  "trpc",
  "utils",
  "caller",
  "api",
  "helpers",
  "client",
  "t",
  "c",
  "u",
  "proxy",
  "trpcUtils",
  "viewerCaller",
  "adminCaller",
]);

let PROC = new Map<string, string>();
let NODE = new Map<string, string>();
let OLD_SORTED: { segs: string[]; to: string; isProc: boolean }[] = [];
/**
 * Leaf renames whose old name is distinctive (one procedure in the whole
 * router has it, 10+ characters): inside src/server they are also renamed
 * where a sub-router is called by itself (`createCallerFactory(monteCarloRouter)
 * (ctx).computeMonteCarloProjection`, `inferRouterInputs<typeof r>["…"]`).
 */
const LEAF = new Map<string, string>();

function prepare(proc: Map<string, string>, node: Map<string, string>) {
  PROC = proc;
  NODE = node;
  OLD_SORTED = [
    ...[...proc].map(([o, n]) => ({ segs: o.split("."), to: n, isProc: true })),
    ...[...node].map(([o, n]) => ({
      segs: o.split("."),
      to: n,
      isProc: false,
    })),
  ].sort((a, b) => b.segs.length - a.segs.length);
}

type Hit = { start: number; len: number; to: string[] };

/**
 * The first place `segs` holds an old path. A procedure path matches
 * anywhere; a namespace only before a utility member, at the end when
 * `endOk`, or after a known root.
 */
function matchSeq(
  segs: string[],
  endOk: (start: number, len: number) => boolean,
): Hit | undefined {
  for (let i = 0; i < segs.length; i++)
    for (const o of OLD_SORTED) {
      const k = o.segs.length;
      if (i + k > segs.length) continue;
      let eq = true;
      for (let j = 0; j < k; j++)
        if (segs[i + j] !== o.segs[j]) {
          eq = false;
          break;
        }
      if (!eq) continue;
      if (!o.isProc) {
        const next = segs[i + k];
        const ok =
          (next !== undefined && UTILS.has(next)) ||
          (next === undefined && endOk(i, k));
        if (!ok) continue;
      }
      return { start: i, len: k, to: o.to.split(".") };
    }
  return undefined;
}

/** A dotted token in free text (string, comment, doc) with old paths renamed. */
const TOKEN = /(?<![\w$.-])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\.\*)?/g;
function renameText(text: string, wholeTokenNamespaceOk: boolean): string {
  return text.replace(
    TOKEN,
    (all, dotted: string, star: string | undefined) => {
      const segs = dotted.split(".");
      if (segs.length === 1 && !star) return all;
      const hit = matchSeq(
        segs,
        (start, len) =>
          Boolean(star) ||
          (wholeTokenNamespaceOk && start === 0 && len === segs.length),
      );
      if (!hit) return all;
      const out = [
        ...segs.slice(0, hit.start),
        ...hit.to,
        ...segs.slice(hit.start + hit.len),
      ];
      return out.join(".") + (star ?? "");
    },
  );
}
/** `/api/trpc/a.b,c.d` URLs (batched calls are comma-separated). */
function renameUrls(text: string): string {
  return text.replace(
    /(api\/trpc\/)([\w.,]+)/g,
    (_, head: string, list: string) =>
      head +
      list
        .split(",")
        .map((p) => renameText(p, true))
        .join(","),
  );
}

// ---------------------------------------------------------------------------
// Code files, by syntax tree
// ---------------------------------------------------------------------------

type Edit = { start: number; end: number; text: string };

function codeEdits(file: string, text: string): Edit[] {
  const kind =
    file.endsWith(".tsx") || file.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const edits: Edit[] = [];
  const serverFile = file.startsWith("src/server/");
  const line = (pos: number) =>
    `${file}:${sf.getLineAndCharacterOfPosition(pos).line + 1}`;

  // Property-access chains, from the outermost access.
  const chain = (top: ts.PropertyAccessExpression) => {
    const names: ts.MemberName[] = [];
    let n: ts.Expression = top;
    while (ts.isPropertyAccessExpression(n)) {
      names.unshift(n.name);
      n = n.expression;
    }
    const rootName = ts.isIdentifier(n) ? n.text : undefined;
    const segs = [...(rootName ? [rootName] : []), ...names.map((x) => x.text)];
    const offset = rootName ? 1 : 0;
    const prev = (s: number) =>
      s > 0
        ? segs[s - 1]
        : n
            .getText(sf)
            .split(/[.()\s]+/)
            .filter(Boolean)
            .at(-1);
    const hit = matchSeq(segs, (s) => ROOTS.has(prev(s) ?? ""));
    if (!hit) {
      if (serverFile)
        for (const nm of names)
          if (LEAF.has(nm.text)) {
            edits.push({
              start: nm.getStart(sf),
              end: nm.end,
              text: LEAF.get(nm.text)!,
            });
            report.rootIdentifierMatches.push(
              `${line(nm.getStart(sf))}: sub-router call .${nm.text} → .${LEAF.get(nm.text)}`,
            );
          }
      return;
    }
    if (hit.start === 0 && rootName)
      report.rootIdentifierMatches.push(
        `${line(top.getStart(sf))}: ${top.getText(sf).slice(0, 80)}`,
      );
    const first = hit.start - offset < 0 ? n : names[hit.start - offset];
    const last = names[hit.start - offset + hit.len - 1];
    if (!first || !last) return;
    const span = text.slice(first.getStart(sf), last.end);
    if (span.includes("?.") || /\s/.test(span)) {
      report.manual.push(
        `${line(first.getStart(sf))}: optional or wrapped chain ${span.replace(/\s+/g, " ")}`,
      );
      return;
    }
    edits.push({
      start: first.getStart(sf),
      end: last.end,
      text: hit.to.join("."),
    });
  };

  // Qualified names in types: `typeof trpc.a.b.useMutation`.
  const qualified = (top: ts.QualifiedName) => {
    const names: ts.Identifier[] = [];
    let n: ts.EntityName = top;
    while (ts.isQualifiedName(n)) {
      names.unshift(n.right);
      n = n.left;
    }
    names.unshift(n);
    const segs = names.map((x) => x.text);
    const hit = matchSeq(segs, (s) => s > 0 && ROOTS.has(segs[s - 1]!));
    if (!hit) return;
    const first = names[hit.start]!,
      last = names[hit.start + hit.len - 1]!;
    if (/\s/.test(text.slice(first.getStart(sf), last.end))) {
      report.manual.push(
        `${line(first.getStart(sf))}: wrapped type name; edit by hand`,
      );
      return;
    }
    edits.push({
      start: first.getStart(sf),
      end: last.end,
      text: hit.to.join("."),
    });
  };

  // Indexed access types: RouterOutputs["a"]["b"].
  const indexed = (top: ts.IndexedAccessTypeNode) => {
    const parts: ts.IndexedAccessTypeNode[] = [];
    let n: ts.TypeNode = top;
    while (ts.isIndexedAccessTypeNode(n)) {
      parts.unshift(n);
      n = n.objectType;
    }
    const segs: string[] = [];
    for (const p of parts) {
      const it = p.indexType;
      if (ts.isLiteralTypeNode(it) && ts.isStringLiteral(it.literal))
        segs.push(it.literal.text);
      else break;
    }
    const hit = matchSeq(segs, (s) => s === 0);
    if (!hit || hit.start !== 0) {
      if (serverFile)
        for (const p of parts) {
          const it = p.indexType;
          if (
            ts.isLiteralTypeNode(it) &&
            ts.isStringLiteral(it.literal) &&
            LEAF.has(it.literal.text)
          ) {
            edits.push({
              start: it.literal.getStart(sf) + 1,
              end: it.literal.end - 1,
              text: LEAF.get(it.literal.text)!,
            });
            report.rootIdentifierMatches.push(
              `${line(it.getStart(sf))}: sub-router type ["${it.literal.text}"]`,
            );
          }
        }
      return;
    }
    const firstIdx = parts[0]!.indexType;
    const lastPart = parts[hit.len - 1]!;
    const q = firstIdx.getText(sf)[0] === "'" ? "'" : '"';
    // From the first `[` to the last matched `]`.
    const open = text.lastIndexOf("[", firstIdx.getStart(sf));
    edits.push({
      start: open,
      end: lastPart.end,
      text: hit.to.map((s) => `[${q}${s}${q}]`).join(""),
    });
  };

  // Object-literal keys: the key path through nested literals.
  const literalKeys = (prop: ts.ObjectLiteralElementLike) => {
    const props: ts.ObjectLiteralElementLike[] = [];
    let p: ts.Node = prop;
    for (;;) {
      if (!(
        ts.isPropertyAssignment(p) ||
        ts.isShorthandPropertyAssignment(p) ||
        ts.isMethodDeclaration(p)
      ))
        break;
      props.unshift(p as ts.ObjectLiteralElementLike);
      const lit = p.parent;
      if (!ts.isObjectLiteralExpression(lit)) break;
      let up: ts.Node = lit.parent;
      while (
        ts.isParenthesizedExpression(up) ||
        ts.isAsExpression(up) ||
        ts.isSatisfiesExpression(up)
      )
        up = up.parent;
      if (!ts.isPropertyAssignment(up)) break;
      p = up;
    }
    const keyText = (q: ts.ObjectLiteralElementLike) => {
      const nm = q.name;
      return nm && (ts.isIdentifier(nm) || ts.isStringLiteral(nm))
        ? nm.text
        : undefined;
    };
    const segs: string[] = [];
    for (const q of props) {
      const k = keyText(q);
      if (k === undefined) return;
      segs.push(k);
    }
    const hit = matchSeq(segs, () => false);
    if (!hit) return;
    // Only the deepest property reports, to visit each path once.
    if (hit.start + hit.len > props.length) return;
    const old = segs.slice(hit.start, hit.start + hit.len);
    if (old.length !== hit.to.length) {
      report.manual.push(
        `${line(props[hit.start]!.getStart(sf))}: object literal ${old.join(".")} → ${hit.to.join(".")} changes nesting; edit by hand`,
      );
      return;
    }
    old.forEach((o, j) => {
      if (o === hit.to[j]) return;
      const nm = props[hit.start + j]!.name!;
      const quoted = ts.isStringLiteral(nm);
      const textNew = quoted
        ? `${nm.getText(sf)[0]}${hit.to[j]}${nm.getText(sf)[0]}`
        : hit.to[j]!;
      if (ts.isShorthandPropertyAssignment(props[hit.start + j]!)) {
        report.manual.push(
          `${line(nm.getStart(sf))}: shorthand key ${o}; edit by hand`,
        );
        return;
      }
      edits.push({ start: nm.getStart(sf), end: nm.end, text: textNew });
    });
  };

  const strings = (
    node:
      | ts.StringLiteral
      | ts.NoSubstitutionTemplateLiteral
      | ts.TemplateLiteralLikeNode,
  ) => {
    const raw = node.getText(sf);
    // Inner raw text, between the quote/backtick/`}` and the quote/backtick/`${`.
    const startOff = 1;
    let endOff = 1;
    if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) endOff = 2;
    const inner = raw.slice(startOff, raw.length - endOff);
    const renamed = renameUrls(renameText(inner, true));
    if (renamed !== inner)
      edits.push({
        start: node.getStart(sf) + startOff,
        end: node.getStart(sf) + startOff + inner.length,
        text: renamed,
      });
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      !(
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node
      )
    )
      chain(node);
    if (ts.isQualifiedName(node) && !ts.isQualifiedName(node.parent))
      qualified(node);
    if (
      ts.isIndexedAccessTypeNode(node) &&
      !(
        ts.isIndexedAccessTypeNode(node.parent) &&
        node.parent.objectType === node
      )
    )
      indexed(node);
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodDeclaration(node)) &&
      ts.isObjectLiteralExpression(node.parent)
    ) {
      const init = ts.isPropertyAssignment(node) ? node.initializer : undefined;
      let inner: ts.Node | undefined = init;
      while (
        inner &&
        (ts.isParenthesizedExpression(inner) ||
          ts.isAsExpression(inner) ||
          ts.isSatisfiesExpression(inner))
      )
        inner = inner.expression;
      if (!inner || !ts.isObjectLiteralExpression(inner)) literalKeys(node);
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      // An import specifier is a module path, never a procedure path.
      if (!(
        ts.isImportDeclaration(node.parent) ||
        ts.isExportDeclaration(node.parent) ||
        ts.isExternalModuleReference(node.parent)
      ))
        strings(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Comments: whole paths only (and `ns.*`).
  const seen = new Set<number>();
  const scanComments = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      const c = text.slice(r.pos, r.end);
      let renamed = renameUrls(renameText(c, false));
      if (serverFile)
        for (const [o, n] of LEAF)
          renamed = renamed.replace(
            new RegExp(`(?<![\\w.$])${o}(?![\\w$])`, "g"),
            n,
          );
      if (renamed !== c)
        edits.push({ start: r.pos, end: r.end, text: renamed });
    }
  };
  const walkComments = (node: ts.Node) => {
    scanComments(ts.getLeadingCommentRanges(text, node.getFullStart()));
    scanComments(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, walkComments);
  };
  walkComments(sf);
  scanComments(
    ts.getLeadingCommentRanges(text, sf.endOfFileToken.getFullStart()),
  );
  return edits;
}

function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of sorted) {
    if (e.end > lastStart) continue; // overlapping: keep the later (inner) one only once
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Router definitions
// ---------------------------------------------------------------------------

function routerSourceEdits(catalog: Entry[]) {
  const bySource = new Map(catalog.map((e) => [e.path, e.source]));
  const sourceOf = (o: string, n: string) => bySource.get(o) ?? bySource.get(n);
  const keyEdit = (
    file: string,
    oldKey: string,
    newKey: string,
    want: (init: ts.Expression) => boolean,
  ) => {
    const f = abs(file);
    const text = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
    const found: ts.PropertyAssignment[] = [];
    const already: ts.PropertyAssignment[] = [];
    const visit = (n: ts.Node) => {
      if (
        ts.isPropertyAssignment(n) &&
        ts.isIdentifier(n.name) &&
        want(n.initializer)
      ) {
        if (n.name.text === oldKey) found.push(n);
        if (n.name.text === newKey) already.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (found.length === 1) {
      const nm = found[0]!.name;
      remember(file);
      if (!DRY)
        fs.writeFileSync(
          f,
          text.slice(0, nm.getStart(sf)) + newKey + text.slice(nm.end),
        );
      report.routerEdits.push(`${file}: key ${oldKey} → ${newKey}`);
      note(file);
    } else if (found.length === 0 && already.length >= 1) {
      // applied
    } else
      report.manual.push(
        `${file}: ${found.length} router keys named ${oldKey}; rename by hand`,
      );
  };
  const isProcedure = (init: ts.Expression) =>
    /\.(query|mutation)\s*\(/.test(init.getText());
  const isRouter = (init: ts.Expression) =>
    /^(createTRPCRouter|mergeRouters)\s*\(|Router$/.test(init.getText().trim());

  for (const [o, n] of PROC) {
    const os = o.split("."),
      ns = n.split(".");
    if (os.length !== ns.length) continue;
    const firstDiff = os.findIndex((s, i) => s !== ns[i]);
    const sameAfter =
      os.slice(firstDiff + 1).join(".") === ns.slice(firstDiff + 1).join(".");
    if (!sameAfter) continue;
    if (firstDiff === os.length - 1) {
      const src = sourceOf(o, n);
      if (src)
        keyEdit(
          `src/server/routers/${src}`,
          os.at(-1)!,
          ns.at(-1)!,
          isProcedure,
        );
    }
  }
  // Namespace keys renamed in place (same parent): root in index.ts, nested where defined.
  const doneNodes = new Set<string>();
  for (const [o, n] of NODE) {
    const os = o.split("."),
      ns = n.split(".");
    if (
      os.length !== ns.length ||
      os.slice(0, -1).join(".") !== ns.slice(0, -1).join(".")
    )
      continue;
    if (doneNodes.has(o)) continue;
    doneNodes.add(o);
    if (os.length === 1)
      keyEdit("src/server/routers/index.ts", os[0]!, ns[0]!, isRouter);
    else {
      const files = new Set(
        [...PROC]
          .filter(([p]) => under(p, o))
          .map(([p, q]) => sourceOf(p, q))
          .filter(Boolean),
      );
      for (const s of files) {
        const file = `src/server/routers/${s}`;
        const t = fs.readFileSync(abs(file), "utf8");
        if (new RegExp(`\\b${os.at(-1)}\\s*:\\s*createTRPCRouter`).test(t))
          keyEdit(file, os.at(-1)!, ns.at(-1)!, isRouter);
      }
    }
  }
}

function applyRouterEdits() {
  for (const e of area.edits) {
    const f = abs(e.file);
    const t = fs.readFileSync(f, "utf8");
    const hasFrom = e.from !== "" && t.includes(e.from);
    const hasTo = e.to !== "" && t.includes(e.to);
    // Applied already: the new text is there (an insertion keeps its anchor).
    if (hasTo || (!hasFrom && e.to === "")) continue;
    if (!hasFrom) {
      report.manual.push(
        `${e.file}: routerEdit text not found: ${JSON.stringify(e.from).slice(0, 80)}`,
      );
      continue;
    }
    remember(e.file);
    if (!DRY) fs.writeFileSync(f, t.replace(e.from, e.to));
    report.routerEdits.push(
      `${e.file}: ${JSON.stringify(e.from).slice(0, 60)} → ${JSON.stringify(e.to).slice(0, 60)}`,
    );
    note(e.file);
  }
}

// ---------------------------------------------------------------------------
// File moves (git mv; import specifiers and path-keyed bookkeeping follow)
// ---------------------------------------------------------------------------

const stripExt = (p: string) =>
  p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "").replace(/\/index$/, "");

function moveFiles(files: string[]) {
  for (const [from, to] of area.moves) {
    if (!fs.existsSync(abs(from))) {
      if (!fs.existsSync(abs(to)))
        report.manual.push(`move ${from}: neither side exists`);
      continue;
    }
    remember(from);
    // The moved file's text before the run is its old file's.
    if (ORIGINAL.has(from)) ORIGINAL.set(to, ORIGINAL.get(from)!);
    if (!DRY) {
      fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
      git("mv", from, to);
    }
    report.moves.push({ from, to });
    // Import specifiers that point at the old module, in every code file;
    // the moved file's own relative imports.
    const oldMod = stripExt(from),
      newMod = stripExt(to);
    for (const file of files.map((f) => (f === from ? to : f))) {
      if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(file) || !plainFile(file)) continue;
      const text = fs.readFileSync(abs(file), "utf8");
      const self = file === to;
      const was = self ? from : file;
      const out = text.replace(
        /((?:from|import|mock|require)\s*\(?\s*)(["'])([^"']+)\2/g,
        (all, head, q, spec: string) => {
          let target: string | undefined;
          if (spec.startsWith("@/")) target = `src/${spec.slice(2)}`;
          else if (spec.startsWith("."))
            target = path.posix.normalize(
              path.posix.join(path.posix.dirname(was), spec),
            );
          else return all;
          const t = stripExt(target);
          let dest: string;
          if (t === oldMod) dest = newMod;
          else if (self && spec.startsWith(".")) dest = t;
          else return all;
          let next: string;
          if (spec.startsWith("@/")) next = `@/${dest.replace(/^src\//, "")}`;
          else {
            next = path.posix.relative(path.posix.dirname(file), dest);
            if (!next.startsWith(".")) next = `./${next}`;
          }
          return next === spec ? all : `${head}${q}${next}${q}`;
        },
      );
      if (out !== text) {
        remember(file);
        if (!DRY) fs.writeFileSync(abs(file), out);
        note(file);
      }
    }
    // The file's path where text names it: bookkeeping keys, tests, comments,
    // docs. The whole path, then each shorter suffix of two or more parts
    // not preceded by a slash (`settings/jobs.ts` → `routers/jobs.ts`).
    const os = from.split("/"),
      ns = to.split("/");
    const pairs: [RegExp, string][] = [];
    for (let k = os.length; k >= 2; k--) {
      const o = os.slice(-k).join("/"),
        n = ns.slice(-Math.min(k, ns.length)).join("/");
      const esc = o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pairs.push([new RegExp(`(?<![\\w./-])${esc}(?![\\w])`, "g"), n]);
    }
    for (const file of files) {
      if (SKIP.some((r) => r.test(file)) || file === from || !plainFile(file))
        continue;
      if (!/\.(tsx?|jsx?|mjs|cjs|json|md|sh|ya?ml)$/.test(file)) continue;
      const t = fs.readFileSync(abs(file), "utf8");
      if (!t.includes(os.at(-1)!)) continue;
      let out = t;
      for (const [re, n] of pairs) out = out.replace(re, n);
      if (out !== t) {
        remember(file);
        if (!DRY) fs.writeFileSync(abs(file), out);
        note(file);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const SKIP = [
  /^CHANGELOG\.md$/,
  /^docs\/CHANGELOG-.*\.md$/,
  /^drizzle(-sqlite)?\//,
  /^\.scratch\//,
  /(^|\/)node_modules\//,
  /^src\/lib\/generated\//,
  /^docs\/API_ROUTERS\.md$/,
  /^docs\/SCHEMA\.md$/,
  /^pnpm-lock\.yaml$/,
];
const BASELINE_FILE =
  /^tests\/baseline\/__(baseline|screens)__\/[^/]+\/(.+?)((\[[^\]]*\])?)\.json$/;
const VERB = /^(?:get|list|compute)(?:[A-Z]|$)/;

function sweep(files: string[]) {
  for (const file of files) {
    if (SKIP.some((r) => r.test(file))) continue;
    const f = abs(file);
    // A symlink's target isn't this tree's file: never written through.
    if (!fs.existsSync(f) || fs.lstatSync(f).isSymbolicLink()) continue;
    if (fs.statSync(f).isDirectory()) continue;
    // Baseline outputs named by path: renamed, bytes unchanged.
    const b = BASELINE_FILE.exec(file);
    if (b) {
      const to = PROC.get(b[2]!);
      if (to) {
        const dest = file.replace(`/${b[2]}${b[3]}.json`, `/${to}${b[3]}.json`);
        if (!DRY) git("mv", file, dest);
        report.baselineRenames.push({ from: file, to: dest });
      }
      continue;
    }
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    let out = text;
    if (file === "tests/lint/procedure-verbs.test.ts") {
      out = out
        .split("\n")
        .filter((l) => {
          const m = /^\s*"([\w.]+)",\s*$/.exec(l);
          const to = m && PROC.get(m[1]!);
          if (to && VERB.test(to.split(".").at(-1)!)) {
            report.offPrefixDropped.push(m![1]!);
            return false;
          }
          return true;
        })
        .join("\n")
        .replace(
          /const OFF_PREFIX_KNOWN = \[\s*\];/,
          "const OFF_PREFIX_KNOWN: string[] = [];",
        );
    }
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(file))
      out = applyEdits(out, codeEdits(file, out));
    else if (/\.json$/.test(file))
      out = out.replace(/"((?:[^"\\\n]|\\.)*)"/g, (all, inner: string) => {
        const r = renameUrls(renameText(inner, true));
        return r === inner ? all : `"${r}"`;
      });
    else if (/\.mdx?$/.test(file))
      out = renameUrls(
        out.replace(
          /(`+)([^`\n]+?)\1/g,
          (all, ticks: string, inner: string) => {
            // A root namespace named alone (`networth`): renamed, and listed.
            const root = NODE.get(inner);
            if (root && !inner.includes(".") && !root.includes(".")) {
              report.manual.push(
                `${file}: \`${inner}\` named alone → \`${root}\` (check the sentence)`,
              );
              return `${ticks}${root}${ticks}`;
            }
            const r = renameText(inner, true);
            return r === inner ? all : `${ticks}${r}${ticks}`;
          },
        ),
      );
    else if (/\.(sh|ya?ml)$/.test(file)) out = renameUrls(out);
    if (out !== text) {
      remember(file);
      if (!DRY) fs.writeFileSync(f, out);
      note(file);
    }
  }
}

// ---------------------------------------------------------------------------
// Abbreviation counts: a renamed key that no longer abbreviates lowers
// ratchet/no-abbreviation's count for its file (what eslint
// --prune-suppressions would write, without re-sorting the whole file).
// ---------------------------------------------------------------------------

async function lowerAbbreviationCounts(touched: string[]) {
  const { abbreviationIn } = (await import(
    new URL("../eslint-ratchet.mjs", import.meta.url).href
  )) as { abbreviationIn: (name: string) => boolean };
  const leaves = [...PROC]
    .map(([o, n]) => [o.split(".").at(-1)!, n.split(".").at(-1)!] as const)
    .filter(([o, n]) => o !== n && abbreviationIn(o) && !abbreviationIn(n));
  if (leaves.length === 0) return;
  const file = abs("eslint-suppressions.json");
  const supp = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  for (const f of touched) {
    if (!/^src\/.*\.(tsx?|mjs|cjs|js)$/.test(f) || !fs.existsSync(abs(f)))
      continue;
    // This run's own change: the text before it touched the file.
    const before = ORIGINAL.get(f);
    if (before === undefined) continue;
    const after = fs.readFileSync(abs(f), "utf8");
    let gone = 0;
    for (const [o] of leaves) {
      const key = new RegExp(`(^|[{,\\s])${o}\\s*:`, "gm");
      gone +=
        (before.match(key) ?? []).length - (after.match(key) ?? []).length;
    }
    const entry = supp[f]?.["ratchet/no-abbreviation"];
    if (gone <= 0 || !entry) continue;
    entry.count -= gone;
    if (entry.count <= 0) delete supp[f]["ratchet/no-abbreviation"];
    if (Object.keys(supp[f]).length === 0) delete supp[f];
    report.routerEdits.push(
      `eslint-suppressions.json: ${f} no-abbreviation −${gone}`,
    );
    changed = true;
  }
  if (changed) {
    fs.writeFileSync(file, JSON.stringify(supp, null, 2) + "\n");
    note("eslint-suppressions.json");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(reportFile: string | undefined) {
  const catalog = readCatalog();
  const { proc, node } = buildMaps(catalog);
  prepare(proc, node);
  const leafCount = new Map<string, number>();
  for (const e of catalog) {
    const l = e.path.split(".").at(-1)!;
    leafCount.set(l, (leafCount.get(l) ?? 0) + 1);
  }
  for (const [o, n] of proc) {
    const ol = o.split(".").at(-1)!,
      nl = n.split(".").at(-1)!;
    if (
      ol !== nl &&
      ol.length >= 10 &&
      (leafCount.get(ol) ?? 0) + (leafCount.get(nl) ?? 0) === 1
    )
      LEAF.set(ol, nl);
  }
  report.procedures = [...proc].map(([from, to]) => ({ from, to }));
  const files = git("ls-files", "-co", "--exclude-standard")
    .split("\n")
    .filter(Boolean);
  moveFiles(files);
  routerSourceEdits(catalog);
  applyRouterEdits();
  for (const d of area.deletes)
    if (fs.existsSync(abs(d))) {
      if (!DRY) git("rm", "-qf", d);
      report.routerEdits.push(`${d}: deleted`);
      // Its size entries go with it; any other mention is listed.
      const sb = abs("size-baseline.json");
      const t = fs.readFileSync(sb, "utf8");
      const out = t
        .split("\n")
        .filter((l) => !l.includes(`"${d}"`))
        .join("\n");
      if (out !== t && !DRY)
        fs.writeFileSync(sb, out.replace(/,(\n\s*})/g, "$1"));
      try {
        for (const l of git(
          "grep",
          "-n",
          "-F",
          d.replace(/\.ts$/, ""),
          "--",
          ".",
          ":!CHANGELOG.md",
        )
          .split("\n")
          .filter(Boolean))
          report.manual.push(`deleted ${d} still named: ${l.slice(0, 160)}`);
      } catch {
        /* none */
      }
    }
  const after = git("ls-files", "-co", "--exclude-standard")
    .split("\n")
    .filter(Boolean);
  sweep(after);

  if (POST && !DRY) {
    const touched = new Set([
      ...Object.keys(report.files),
      ...git("diff", "HEAD", "--name-only", "--diff-filter=AMR")
        .split("\n")
        .filter(Boolean),
    ]);
    const changed = [...touched].filter(
      (f) =>
        fs.existsSync(abs(f)) &&
        /\.(tsx?|jsx?|mjs|cjs|json|md)$/.test(f) &&
        !/^tests\/baseline\/__/.test(f),
    );
    const run = (cmd: string, args: string[]) => {
      try {
        execFileSync(cmd, args, {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
          maxBuffer: 1 << 26,
        });
      } catch (e) {
        report.manual.push(
          `${cmd} ${args.slice(0, 3).join(" ")}… failed: ${String((e as { stderr?: string }).stderr ?? e).slice(0, 300)}`,
        );
      }
    };
    if (changed.length)
      run("npx", ["prettier", "--write", "--log-level", "warn", ...changed]);
    run("npx", ["tsx", "scripts/gen-api-docs.ts"]);
    run("npx", [
      "prettier",
      "--write",
      "--log-level",
      "warn",
      "docs/API_ROUTERS.md",
      "docs/SCHEMA.md",
    ]);
    run("npx", ["tsx", "scripts/verify-docs.ts", "--update"]);
    // A rewritten count can change a table cell's width: re-pad what
    // --update wrote (lane H: DESIGN's settingsSubRouters 10 → 4).
    run("npx", [
      "prettier",
      "--write",
      "--log-level",
      "warn",
      "docs/DESIGN.md",
    ]);
    // A recorded size this run's re-wrap or mount lines raised is recorded
    // at its new size (check-ratchets excuses it in a proven Rename-path:
    // commit); then sizes that fell are lowered.
    const src = changed.filter((f) => /^src\/.*\.tsx?$/.test(f)).sort();
    if (src.length > 0) {
      const raised = execFileSync(
        "npx",
        ["tsx", "scripts/check-size-baseline.ts", "--raise-renamed", ...src],
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      report.sizeRaised.push(
        ...raised.split("\n").filter((l) => l.startsWith("raised ")),
      );
    }
    run("npx", ["tsx", "scripts/check-size-baseline.ts", "--update"]);
    await lowerAbbreviationCounts([...touched]);
  }

  // Leftovers: a whole old path still written anywhere outside the skips.
  if (!DRY)
    for (const o of PROC.keys()) {
      let out = "";
      try {
        out = git(
          "grep",
          "-n",
          "-F",
          "-w",
          o,
          "--",
          ".",
          ":!CHANGELOG.md",
          ":!docs/CHANGELOG-*",
          ":!drizzle",
          ":!drizzle-sqlite",
        );
      } catch {
        continue;
      }
      for (const l of out.split("\n").filter(Boolean))
        report.manual.push(`leftover ${o}: ${l.slice(0, 160)}`);
    }

  const numstat = DRY ? "" : git("diff", "HEAD", "--numstat", "-M100%");
  const summary = {
    ...report,
    numstat: numstat.split("\n").filter(Boolean),
  };
  if (reportFile)
    fs.writeFileSync(reportFile, JSON.stringify(summary, null, 2));
  console.log(
    `${area.id}: ${report.procedures.length} procedures, ${Object.keys(report.files).length} files rewritten, ` +
      `${report.baselineRenames.length} baseline files renamed, ${report.moves.length} moves, ` +
      `${report.routerEdits.length} router edits, ${report.offPrefixDropped.length} OFF_PREFIX_KNOWN dropped, ` +
      `${report.manual.length} manual, ${report.rootIdentifierMatches.length} root-identifier matches`,
  );
  for (const m of report.sizeRaised) console.log(`  size: ${m}`);
  for (const m of report.manual) console.log(`  manual: ${m}`);
  for (const m of report.rootIdentifierMatches)
    console.log(`  root-identifier: ${m}`);
}

/** The run's map: the message's trailers, or a map.json area. */
function readArea(argv: string[]): (RenamePathMap & { id: string }) | string {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const messageFile = flag("--message");
  const mapFile = flag("--map");
  const id = flag("--area");
  if (messageFile && !mapFile && !id) {
    const { map, problems } = readRenamePaths(
      fs.readFileSync(messageFile, "utf8"),
    );
    if (problems.length > 0) return problems.join("\n");
    if (!map) return `${messageFile} has no Rename-path: line`;
    return { id: path.basename(messageFile), ...map };
  }
  if (mapFile && id && !messageFile) {
    const areas = (
      JSON.parse(fs.readFileSync(mapFile, "utf8")) as { areas: MapArea[] }
    ).areas;
    const found = areas.find((a) => a.id === id);
    if (!found)
      return `no area ${id} in ${mapFile} (${areas.map((a) => a.id).join(", ")})`;
    return { id, ...mapOfArea(found) };
  }
  return USAGE;
}

if (
  process.argv[1] &&
  // Real paths: a worktree may hold the script as a symlink.
  fs.realpathSync(path.resolve(process.argv[1])) ===
    fs.realpathSync(fileURLToPath(import.meta.url))
) {
  const argv = process.argv.slice(2);
  const read = readArea(argv);
  if (typeof read === "string") {
    console.error(read);
    process.exit(2);
  }
  area = read;
  report.area = read.id;
  if (argv.includes("--print-trailers")) {
    console.log(renamePathTrailers(read).join("\n"));
    process.exit(0);
  }
  const at = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  ROOT = path.resolve(at("--root") ?? process.cwd());
  DRY = argv.includes("--dry-run");
  POST = !argv.includes("--no-post");
  main(at("--report")).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
