/**
 * Every test file under tests/ is run by exactly one vitest project. A file
 * no project's `include` matches (or that its `exclude` takes back) never
 * runs, and the gate's related-tests step skips it without a word; one that
 * two projects match runs twice, in two environments. The projects are read
 * from vitest.config.ts with the TypeScript parser, their globs matched as
 * vitest matches them (relative to the root, extglobs included).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const CONFIG = "vitest.config.ts";
const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "__baseline__", "__sync__"]);

type Project = { name: string; include: string[]; exclude: string[] };

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (TEST_FILE.test(e.name))
      yield path.relative(ROOT, full).split(path.sep).join("/");
  }
}

const propName = (p: ts.ObjectLiteralElementLike) =>
  ts.isPropertyAssignment(p) &&
  (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
    ? p.name.text
    : undefined;

/** The value of `name:` in an object literal, if it has one. */
function prop(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const found = obj.properties.find((p) => propName(p) === name);
  return found && ts.isPropertyAssignment(found)
    ? found.initializer
    : undefined;
}

function strings(node: ts.Expression | undefined): string[] {
  if (!node) return [];
  if (!ts.isArrayLiteralExpression(node))
    throw new Error(`${CONFIG}: an include/exclude that isn't a list`);
  return node.elements.map((el) => {
    if (!ts.isStringLiteralLike(el))
      throw new Error(`${CONFIG}: a glob that isn't a string literal`);
    return el.text;
  });
}

/** `test.projects` in vitest.config.ts: each project's name and globs. */
function projectsIn(text: string): Project[] {
  const sf = ts.createSourceFile(CONFIG, text, ts.ScriptTarget.Latest, true);
  let list: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      propName(node) === "projects" &&
      ts.isArrayLiteralExpression(node.initializer)
    )
      list = node.initializer;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!list) throw new Error(`${CONFIG}: no test.projects list`);
  return list.elements.map((el) => {
    const test =
      ts.isObjectLiteralExpression(el) && prop(el, "test")
        ? prop(el, "test")
        : undefined;
    if (!test || !ts.isObjectLiteralExpression(test))
      throw new Error(`${CONFIG}: a project that isn't { test: { … } }`);
    const name = prop(test, "name");
    return {
      name: name && ts.isStringLiteralLike(name) ? name.text : "(unnamed)",
      include: strings(prop(test, "include")),
      exclude: strings(prop(test, "exclude")),
    };
  });
}

/** The projects that run `file`: an include matches it, no exclude does. */
function runBy(file: string, projects: Project[]): string[] {
  const hit = (globs: string[]) => globs.some((g) => path.matchesGlob(file, g));
  return projects
    .filter((p) => hit(p.include) && !hit(p.exclude))
    .map((p) => p.name);
}

describe("vitest projects", () => {
  it("runs every tests/**/*.test.ts(x) in exactly one project", () => {
    const projects = projectsIn(
      fs.readFileSync(path.join(ROOT, CONFIG), "utf8"),
    );
    const files = [...walk(path.join(ROOT, "tests"))].sort();
    expect(files.length).toBeGreaterThan(0);
    const wrong = files
      .map((file) => ({ file, by: runBy(file, projects) }))
      .filter(({ by }) => by.length !== 1)
      .map(({ file, by }) =>
        by.length === 0
          ? `${file}: no project runs it`
          : `${file}: run by ${by.join(" and ")}`,
      );
    expect(
      wrong,
      `Every test file needs exactly one project in ${CONFIG}`,
    ).toEqual([]);
  });

  it("reads a file no project includes, an excluded one and a doubled one", () => {
    const projects = projectsIn(`export default {
      test: {
        projects: [
          { extends: true, test: { name: "node", include: ["tests/**/*.test.ts"], exclude: ["tests/dom/**"] } },
          { test: { name: "dom", include: ["tests/dom/**/*.test.ts", "tests/both/*.test.ts"] } },
        ],
      },
    };`);
    expect(runBy("tests/a/b.test.ts", projects)).toEqual(["node"]);
    expect(runBy("tests/dom/c.test.ts", projects)).toEqual(["dom"]);
    expect(runBy("tests/dom/c.test.tsx", projects)).toEqual([]);
    expect(runBy("tests/both/d.test.ts", projects)).toEqual(["node", "dom"]);
  });

  it("matches an extglob exclude as vitest does", () => {
    const projects: Project[] = [
      {
        name: "node",
        include: ["tests/**/*.test.ts"],
        exclude: ["tests/c/**/!(pure|helpers).test.ts*"],
      },
    ];
    expect(runBy("tests/c/x/pure.test.ts", projects)).toEqual(["node"]);
    expect(runBy("tests/c/x/view.test.ts", projects)).toEqual([]);
  });
});
