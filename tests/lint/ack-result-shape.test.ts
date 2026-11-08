/**
 * One mutation result shape. A save acknowledges with `{ ok: true }`
 * (`Ack`); a check's outcome (`ProbeResult`, lib/http/probe-result.ts) is
 * `{ ok: true, … } | { ok: false, error }`. `success` is left only in
 * internal returns (rate-limit).
 *
 * So anywhere in src/, a `success: true` (any object literal, returned or
 * not) must sit in a function that also returns an object with
 * `success: false`. A `success` that is never false is an acknowledgement,
 * and a new one fails here: use `{ ok: true }`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

/** Strip parentheses, `as` and `satisfies` around an expression. */
function unwrap(e: ts.Node): ts.Node {
  let x = e;
  while (
    ts.isParenthesizedExpression(x) ||
    ts.isAsExpression(x) ||
    ts.isSatisfiesExpression(x)
  )
    x = x.expression;
  return x;
}

/** `true`/`false` for a literal, else null. */
function literal(e: ts.Expression): boolean | null {
  const x = unwrap(e);
  if (x.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (x.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function isSuccessKey(name: ts.PropertyName): boolean {
  return (
    (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
    name.text === "success"
  );
}

function enclosingFunction(n: ts.Node): ts.Node | undefined {
  let p = n.parent;
  while (p && !ts.isFunctionLike(p)) p = p.parent;
  return p;
}

/** The function an object literal is returned from (a `return` or an
 *  arrow's expression body), or undefined when it isn't returned. */
function returningFunction(obj: ts.Node): ts.Node | undefined {
  let x: ts.Node = obj;
  while (
    ts.isParenthesizedExpression(x.parent) ||
    ts.isAsExpression(x.parent) ||
    ts.isSatisfiesExpression(x.parent)
  )
    x = x.parent;
  if (ts.isReturnStatement(x.parent)) return enclosingFunction(x.parent);
  if (ts.isArrowFunction(x.parent) && x.parent.body === x) return x.parent;
  return undefined;
}

/** `file:line` of each `success: true` whose function never returns false. */
function ackSuccesses(file: string, text: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const trues: ts.Node[] = [];
  const canFail = new Set<ts.Node>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && isSuccessKey(n.name)) {
      const v = literal(n.initializer);
      if (v === true) trues.push(n);
      const fn = v === false ? returningFunction(n.parent) : undefined;
      if (fn) canFail.add(fn);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return trues
    .filter((n) => {
      const fn = enclosingFunction(n);
      return !fn || !canFail.has(fn);
    })
    .map(
      (n) =>
        `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
    );
}

const lines = (...l: string[]) => l.join("\n");

describe("acknowledgements are { ok: true }, not { success: true }", () => {
  it.each([
    ["a flat ack", "const f = async () => ({ success: true });", 1],
    [
      "a quoted key",
      'const f = async () => { await save(); return { "success": true }; };',
      1,
    ],
    [
      "a spread",
      "const f = async () => { return { success: true, ...(await rest()) }; };",
      1,
    ],
    ["a parenthesised value", "const f = () => a({ success: (true) });", 1],
    [
      "a satisfies value",
      "const f = () => ({ success: true satisfies boolean });",
      1,
    ],
    [
      "an ack in a callback, the outer function returning false",
      lines(
        "async function f() {",
        "  if (x) return { success: false, error: 'no' };",
        "  await db.transaction(async (tx) => { return { success: true }; });",
        "}",
      ),
      3,
    ],
    [
      "a false that isn't returned",
      lines(
        "function f() {",
        "  log({ meta: { success: false } });",
        "  return { success: true };",
        "}",
      ),
      3,
    ],
  ])("flags %s", (_, code, line) => {
    expect(ackSuccesses("a.ts", code)).toEqual([`a.ts:${line}`]);
  });

  it("passes a probe", () => {
    const probe = lines(
      "const f = async () => {",
      "  try { return { success: true as const, n: 1 }; }",
      "  catch { return ({ success: false as const, error: 'x' }); }",
      "};",
    );
    expect(ackSuccesses("p.ts", probe)).toEqual([]);
  });

  it("no src/ function says success: true without returning false", () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(ROOT, file);
      found.push(...ackSuccesses(rel, fs.readFileSync(file, "utf8")));
    }
    expect(found).toEqual([]);
  });
});
