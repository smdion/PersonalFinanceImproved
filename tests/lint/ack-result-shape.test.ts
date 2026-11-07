/**
 * One mutation result shape (v0.10.4 Q10). A save acknowledges with
 * `{ ok: true }`; `success` belongs to a check's outcome (`ProbeResult`,
 * lib/http/probe-result.ts), which can come back `success: false`.
 *
 * So in src/server, a function that returns `success: true` must also have a
 * `success: false` return: a `success` that is never false is an
 * acknowledgement, and a new one fails here. Use `{ ok: true }`.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(ROOT, "src/server");

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(e.name)) yield full;
  }
}

/** `true`/`false` for a literal (`as const` allowed), else null. */
function literal(e: ts.Expression): boolean | null {
  const x = ts.isAsExpression(e) ? e.expression : e;
  if (x.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (x.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function enclosingFunction(n: ts.Node): ts.Node | undefined {
  let p = n.parent;
  while (p && !ts.isFunctionLike(p)) p = p.parent;
  return p;
}

/** `file:line` of each `success: true` whose function never says false. */
function ackSuccesses(file: string, text: string): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const trues: ts.Node[] = [];
  const canFail = new Set<ts.Node | undefined>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "success") {
      const v = literal(n.initializer);
      if (v === true) trues.push(n);
      if (v === false) canFail.add(enclosingFunction(n));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return trues
    .filter((n) => !canFail.has(enclosingFunction(n)))
    .map(
      (n) =>
        `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`,
    );
}

describe("acknowledgements are { ok: true }, not { success: true }", () => {
  it("finds an ack-only success and passes a probe", () => {
    const ack =
      "const f = async () => { await save(); return { success: true }; };";
    const probe =
      "const f = async () => { try { return { success: true as const, n: 1 }; } catch { return { success: false as const, error: 'x' }; } };";
    expect(ackSuccesses("a.ts", ack)).toEqual(["a.ts:1"]);
    expect(ackSuccesses("p.ts", probe)).toEqual([]);
  });

  it("no src/server function returns a success that is never false", () => {
    const found: string[] = [];
    for (const file of walk(SERVER)) {
      const rel = path.relative(ROOT, file);
      found.push(...ackSuccesses(rel, fs.readFileSync(file, "utf8")));
    }
    expect(found).toEqual([]);
  });
});
