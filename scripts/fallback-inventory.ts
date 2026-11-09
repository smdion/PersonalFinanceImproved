/**
 * The fallback inventory behind docs/FALLBACKS.md (plan 3k-i): every
 * fallback in src/ found by the TypeScript AST, counted by kind and area.
 * A site is `?? <default>`, `|| <default>`, `??=` / `||=`, a `catch` (or a
 * promise `.catch`) that returns a value, or a `default:` branch. The
 * ratchet (`ratchet/no-unregistered-fallback`) counts a subset; `counted`
 * marks it here with the same exemptions (Map `.get` reads and accumulator seeds).
 *
 * Usage:  pnpm tsx scripts/fallback-inventory.ts           (counts by kind and area)
 *         pnpm tsx scripts/fallback-inventory.ts --list    (every site, tab-separated)
 *         pnpm tsx scripts/fallback-inventory.ts --json    (every site as JSON)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type Area = "money" | "ui" | "other";
export type Site = {
  file: string;
  line: number;
  kind: string;
  area: Area;
  /** The ratchet counts it (docs/FALLBACKS.md § The ratchet). */
  counted: boolean;
};

const MONEY = /^src\/(lib\/pure|server\/(services|data|routers))\//;
const UI = /^src\/(components|app|lib\/hooks)\//;

export function areaOf(file: string): Area {
  if (MONEY.test(file)) return "money";
  return UI.test(file) ? "ui" : "other";
}

/** The default's shape: `0`, `null`, `[]`, `""`, `{}`, or a wider class. */
function defaultKind(node: ts.Expression): string {
  if (ts.isNumericLiteral(node)) return node.text === "0" ? "0" : "number";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text === "" ? '""' : "string";
  if (ts.isArrayLiteralExpression(node))
    return node.elements.length ? "array" : "[]";
  if (ts.isObjectLiteralExpression(node))
    return node.properties.length ? "object" : "{}";
  if (node.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(node) && node.text === "undefined") return "undefined";
  if (
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  )
    return "boolean";
  return "expression";
}

function unwrap(node: ts.Expression): ts.Expression {
  let n = node;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isAsExpression(n)
  )
    n = n.expression;
  return n;
}

/** `m.get(k)`: a sparse Map read, no entry meaning none (owner FQ1, N6). A
 *  computed record read (`rec[k] ?? 0`) is counted. */
export function isMapGet(node: ts.Expression): boolean {
  const n = unwrap(node);
  return (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "get"
  );
}

/** `x = (x ?? 0) + v`: the seed of a running total. */
function isAccumulatorSeed(node: ts.BinaryExpression): boolean {
  let up: ts.Node = node.parent;
  while (ts.isParenthesizedExpression(up)) up = up.parent;
  if (
    !ts.isBinaryExpression(up) ||
    (up.operatorToken.kind !== ts.SyntaxKind.PlusToken &&
      up.operatorToken.kind !== ts.SyntaxKind.MinusToken)
  )
    return false;
  const assign = up.parent;
  return (
    ts.isBinaryExpression(assign) &&
    assign.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    assign.left.getText() === node.left.getText()
  );
}

/** A return with a value in `block`, not in a nested function. */
function returnsValue(block: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) found = true;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return found;
}

export function sitesIn(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const area = areaOf(file);
  const sites: Site[] = [];
  const add = (node: ts.Node, kind: string, counted: boolean) =>
    sites.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      area,
      counted,
    });
  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.BarBarToken
      ) {
        const sign = op === ts.SyntaxKind.BarBarToken ? "||" : "??";
        const shape = defaultKind(node.right);
        // `a || b` with a non-literal right is control flow, not a default.
        if (sign === "??" || shape !== "expression") {
          const exempt = isMapGet(node.left) || isAccumulatorSeed(node);
          const counted = shape === "0" && area === "money" && !exempt;
          add(node, `${sign} ${shape}${exempt ? " (map/seed)" : ""}`, counted);
        }
      }
      if (
        op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        op === ts.SyntaxKind.BarBarEqualsToken
      )
        add(node, "??= / ||=", false);
    }
    if (ts.isCatchClause(node) && returnsValue(node.block))
      add(node, "catch returns a value", true);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch"
    ) {
      const handler = node.arguments[0];
      if (
        handler &&
        (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
      ) {
        const body = handler.body;
        const valued = ts.isBlock(body)
          ? returnsValue(body)
          : !ts.isVoidExpression(body);
        if (valued) add(node, ".catch returns a value", true);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      /^readMaybe[A-Z]/.test(node.expression.text)
    )
      add(node, "plaintext-or-encrypted reader", true);
    if (ts.isDefaultClause(node)) add(node, "default:", false);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

export function inventory(root = ROOT): Site[] {
  return fs
    .readdirSync(path.join(root, "src"), { recursive: true, encoding: "utf8" })
    .map((f) => path.posix.join("src", f.split(path.sep).join("/")))
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"))
    .filter((f) => !f.startsWith("src/lib/generated/"))
    .sort()
    .flatMap((f) => sitesIn(f, fs.readFileSync(path.join(root, f), "utf8")));
}

function summary(sites: Site[]): string {
  const areas: Area[] = ["money", "ui", "other"];
  const byKind = new Map<string, Record<Area, number>>();
  for (const s of sites) {
    const row = byKind.get(s.kind) ?? { money: 0, ui: 0, other: 0 };
    row[s.area] += 1;
    byKind.set(s.kind, row);
  }
  const lines = [`kind\t${areas.join("\t")}\ttotal`];
  for (const [kind, row] of [...byKind].sort((a, b) =>
    a[0].localeCompare(b[0]),
  ))
    lines.push(
      `${kind}\t${areas.map((a) => row[a]).join("\t")}\t${areas.reduce((n, a) => n + row[a], 0)}`,
    );
  const counted = sites.filter((s) => s.counted);
  lines.push(
    `\n${sites.length} sites; the ratchet counts ${counted.length} (${areas.map((a) => `${a} ${counted.filter((s) => s.area === a).length}`).join(", ")})`,
  );
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sites = inventory();
  if (process.argv.includes("--json"))
    console.log(JSON.stringify(sites, null, 1));
  else if (process.argv.includes("--list"))
    for (const s of sites)
      console.log(
        `${s.file}:${s.line}\t${s.kind}\t${s.area}${s.counted ? "\tcounted" : ""}`,
      );
  else console.log(summary(sites));
}
