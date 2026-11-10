/**
 * The dashboard layout and the sign-in page render per request in every
 * build: each starts with `await connection()`. CI's build check
 * (scripts/check-prerender.ts) runs on a build without DEMO_ONLY, where the
 * layout's auth() makes it dynamic anyway; a DEMO_ONLY build skips auth(),
 * and without connection() first it prerendered 20 dashboard routes as a
 * static "Database Unavailable" page (SE5).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../../src");
const PER_REQUEST = ["app/(dashboard)/layout.tsx", "app/login/page.tsx"];

/** The source text of the default-exported function's first statement. */
function firstStatement(file: string): string | null {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const node of source.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.body) continue;
    const kinds = ts.getModifiers(node)?.map((m) => m.kind) ?? [];
    if (!kinds.includes(ts.SyntaxKind.DefaultKeyword)) continue;
    return node.body.statements[0]?.getText(source) ?? null;
  }
  return null;
}

describe("pages that depend on the running server", () => {
  it.each(PER_REQUEST)("%s awaits connection() first", (file) => {
    expect(firstStatement(file)).toBe("await connection();");
  });
});
