// Ratchet rules (docs/RULES.md § Refactoring): each is an error, today's
// cases are counted per file in eslint-suppressions.json, and a count only
// goes down (`npx eslint <files> --prune-suppressions` after a cleanup).
// One rule id per pattern, so a file can't trade one pattern for another.

const TEXT_FIELD =
  /(?:reason|label|message|note|description|warning|text|name|title|explanation|summary|detail)s?$/i;
const STRING_TRANSFORMS = new Set(["toLowerCase", "toUpperCase", "trim"]);

/** Account-type config fields that have a one-field helper in
 *  lib/config/account-types.ts (RULES § Data-Driven Architecture). */
const HELPER_FIELDS = [
  "isOverflowTarget",
  "irsLimitGroup",
  "employerMatchSubType",
  "earlyAccessRule",
  "qcdEligible",
  "nonMedicalPenaltyRate",
  "displayGroup",
  "payrollFicaExempt",
].join("|");

/** Fields whose value is a member of a closed set (account categories,
 *  tax types, filing statuses): a plain `string` type lets any text in. */
const CLOSED_SET_FIELDS = [
  "accountType",
  "category",
  "parentCategory",
  "taxType",
  "taxTreatment",
  "filingStatus",
].join("|");

/** A rule that reports every node a selector matches. */
function selectorRule(description, selector, message) {
  return {
    meta: { type: "suggestion", docs: { description }, schema: [] },
    create(context) {
      return { [selector]: (node) => context.report({ node, message }) };
    },
  };
}

function isStringLiteral(node) {
  return (
    (node?.type === "Literal" && typeof node.value === "string") ||
    (node?.type === "TemplateLiteral" && node.expressions.length === 0)
  );
}

/** The identifier a value was read from, past .toLowerCase() and friends. */
function sourceName(node) {
  let n = node;
  while (
    n?.type === "CallExpression" &&
    n.callee.type === "MemberExpression" &&
    !n.callee.computed &&
    STRING_TRANSFORMS.has(n.callee.property.name)
  ) {
    n = n.callee.object;
  }
  if (n?.type === "ChainExpression") n = n.expression;
  if (n?.type === "Identifier") return n.name;
  if (n?.type === "MemberExpression" && !n.computed) return n.property.name;
  return undefined;
}

const CLASS_TOKENS = /(?:^|\s)fixed(?:\s|$)/;
const INSET_TOKEN = /(?:^|\s)inset-0(?:\s|$)/;
const isOverlayClasses = (text) =>
  CLASS_TOKENS.test(text) && INSET_TOKEN.test(text);

// Past tense about the code, "the fix", drift claims, citations of versions,
// findings, scratch docs and file:line. RULES review rule 1.
const HISTORY_PHRASE =
  /\bthe fix\b|\bused to\b|\bpreviously\b|\bno longer\b|\bcan(?:'|no)?t drift\b|\b(?:was|were) (?:changed|added|removed|moved|renamed|replaced|fixed|introduced)\b|\bregress(?:ed|ion)\b|\bfinding \d|\.scratch\/|\b[\w-]+\.tsx?:\d+\b|\bv\d+\.\d+\.\d+\b/i;
const MAX_COMMENT_LINES = 3;

/** Text lines of a comment, without the delimiter-only lines of a block. */
function commentTextLines(comment) {
  if (comment.type === "Line") return 1;
  return comment.value
    .split("\n")
    .filter((line) => line.replace(/^\s*\*?/, "").trim() !== "").length;
}

/** Comments grouped into blocks: a block comment, or adjacent line comments. */
function commentBlocks(sourceCode) {
  const blocks = [];
  for (const comment of sourceCode.getAllComments()) {
    if (/^\s*(?:eslint|@ts-|prettier-ignore)/.test(comment.value)) continue;
    const last = blocks.at(-1);
    const prev = last?.comments.at(-1);
    const ownLine =
      sourceCode.getTokenBefore(comment, { includeComments: true })?.loc.end
        .line !== comment.loc.start.line;
    if (
      comment.type === "Line" &&
      prev?.type === "Line" &&
      ownLine &&
      prev.loc.end.line === comment.loc.start.line - 1
    ) {
      last.comments.push(comment);
      last.lines += 1;
    } else {
      blocks.push({ comments: [comment], lines: commentTextLines(comment) });
    }
  }
  return blocks;
}

function unparen(text) {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  return t;
}

const isZero = (node) => node.type === "Literal" && node.value === 0;

/**
 * For a ternary test that checks a denominator against zero, the denominator
 * and which branch runs when it is non-zero ("consequent" or "alternate").
 */
function guardOf(test, sourceCode) {
  if (test.type === "UnaryExpression" && test.operator === "!")
    return { d: unparen(sourceCode.getText(test.argument)), live: "alternate" };
  if (test.type === "BinaryExpression") {
    const [other, zeroOnLeft] = isZero(test.right)
      ? [test.left, false]
      : isZero(test.left)
        ? [test.right, true]
        : [undefined, false];
    if (!other) return undefined;
    const d = unparen(sourceCode.getText(other));
    const op = test.operator;
    if (op === "!==" || op === "!=") return { d, live: "consequent" };
    if (op === "===" || op === "==") return { d, live: "alternate" };
    if ((op === ">" && !zeroOnLeft) || (op === "<" && zeroOnLeft))
      return { d, live: "consequent" };
    if ((op === "<=" && !zeroOnLeft) || (op === ">=" && zeroOnLeft))
      return { d, live: "alternate" };
    return undefined;
  }
  if (
    test.type === "Identifier" ||
    test.type === "MemberExpression" ||
    test.type === "ChainExpression"
  )
    return { d: unparen(sourceCode.getText(test)), live: "consequent" };
  return undefined;
}

function dividesBy(node, d, sourceCode) {
  let found = false;
  const visit = (n) => {
    if (found || !n || typeof n.type !== "string") return;
    if (
      n.type === "BinaryExpression" &&
      n.operator === "/" &&
      unparen(sourceCode.getText(n.right)) === d
    ) {
      found = true;
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === "parent") continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === "string") visit(child);
    }
  };
  visit(node);
  return found;
}

const isFallbackLiteral = (node) =>
  node.type === "Literal" ||
  (node.type === "Identifier" && node.name === "undefined") ||
  (node.type === "UnaryExpression" && node.argument.type === "Literal");

/** Form controls the census counts: raw ones and the form primitives. */
const CONTROL_TAGS = new Set([
  "input",
  "select",
  "textarea",
  "FormInput",
  "FormSelect",
  "DateInput",
]);
/** Elements that name the control inside them. */
const LABELLING_TAGS = new Set(["label", "FormField", "FieldRow"]);

const jsxTag = (opening) =>
  opening.name.type === "JSXIdentifier" ? opening.name.name : undefined;
const jsxAttr = (opening, name) =>
  opening.attributes.find(
    (a) => a.type === "JSXAttribute" && a.name.name === name,
  );

const customRules = {
  "no-unlabeled-control": {
    meta: {
      type: "suggestion",
      docs: { description: "Every form control has an accessible name." },
      schema: [],
    },
    create(context) {
      const sourceCode = context.sourceCode;
      // A static id, or the expression an id or htmlFor is written as.
      const idOf = (attr) => {
        const v = attr?.value;
        if (!v) return undefined;
        if (v.type === "Literal") return String(v.value);
        if (v.type === "JSXExpressionContainer")
          return `{${sourceCode.getText(v.expression)}}`;
        return undefined;
      };
      const insideLabel = (opening) => {
        for (let p = opening.parent?.parent; p; p = p.parent)
          if (
            p.type === "JSXElement" &&
            LABELLING_TAGS.has(jsxTag(p.openingElement))
          )
            return true;
        return false;
      };
      const labelled = new Set();
      const controls = [];
      return {
        JSXOpeningElement(node) {
          const tag = jsxTag(node);
          if (tag === "label") {
            const id = idOf(jsxAttr(node, "htmlFor"));
            if (id !== undefined) labelled.add(id);
          }
          if (!CONTROL_TAGS.has(tag)) return;
          if (jsxAttr(node, "type")?.value?.value === "hidden") return;
          if (jsxAttr(node, "aria-label") || jsxAttr(node, "aria-labelledby"))
            return;
          // Spread props may carry the name; they can't be read here.
          if (node.attributes.some((a) => a.type === "JSXSpreadAttribute"))
            return;
          if (insideLabel(node)) return;
          controls.push({ node, id: idOf(jsxAttr(node, "id")) });
        },
        "Program:exit"() {
          for (const { node, id } of controls)
            if (id === undefined || !labelled.has(id))
              context.report({
                node,
                message:
                  "Form control with no accessible name. Give it aria-label, a <label htmlFor> matching its id, or a FormField around it.",
              });
        },
      };
    },
  },
  "no-history-comment": {
    meta: {
      type: "suggestion",
      docs: { description: "Comments state what is true now." },
      schema: [],
    },
    create(context) {
      return {
        Program() {
          for (const comment of context.sourceCode.getAllComments()) {
            const match = HISTORY_PHRASE.exec(comment.value);
            if (match)
              context.report({
                loc: comment.loc,
                message: `History in a comment ("${match[0]}"). State what is true now; history goes in the commit.`,
              });
          }
        },
      };
    },
  },
  "max-comment-lines": {
    meta: {
      type: "suggestion",
      docs: { description: "At most three lines of current reason." },
      schema: [],
    },
    create(context) {
      return {
        Program() {
          for (const block of commentBlocks(context.sourceCode)) {
            if (block.lines <= MAX_COMMENT_LINES) continue;
            const first = block.comments[0];
            context.report({
              loc: {
                start: first.loc.start,
                end: block.comments.at(-1).loc.end,
              },
              message: `Comment of ${block.lines} lines; at most ${MAX_COMMENT_LINES}. If it needs more, change the code or the type first.`,
            });
          }
        },
      };
    },
  },
  "no-stacked-docblock": {
    meta: {
      type: "suggestion",
      docs: { description: "One docblock per declaration." },
      schema: [],
    },
    create(context) {
      return {
        Program() {
          const sourceCode = context.sourceCode;
          const isDoc = (c) => c?.type === "Block" && c.value.startsWith("*");
          // A file's header docblock may sit right above the first declaration's.
          const firstCode = sourceCode.ast.body.find((s) => !s.directive);
          const header = sourceCode
            .getAllComments()
            .find(
              (c) =>
                isDoc(c) && (!firstCode || c.range[1] <= firstCode.range[0]),
            );
          for (const comment of sourceCode.getAllComments()) {
            if (!isDoc(comment) || comment === header) continue;
            const next = sourceCode.getTokenAfter(comment, {
              includeComments: true,
            });
            if (isDoc(next))
              context.report({
                loc: comment.loc,
                message:
                  "Docblock followed by another docblock; the first documents nothing. Merge them or delete the orphan.",
              });
          }
        },
      };
    },
  },
  "no-guarded-division": {
    meta: {
      type: "suggestion",
      docs: {
        description: "Division by a possibly-zero value uses safeDivide.",
      },
      schema: [],
    },
    create(context) {
      const sourceCode = context.sourceCode;
      return {
        ConditionalExpression(node) {
          const guard = guardOf(node.test, sourceCode);
          if (!guard) return;
          const live = node[guard.live];
          const dead =
            node[guard.live === "consequent" ? "alternate" : "consequent"];
          if (isFallbackLiteral(dead) && dividesBy(live, guard.d, sourceCode))
            context.report({
              node,
              message: `Hand-guarded division by '${guard.d}'. Use safeDivide(n, d, fallback) from @/lib/utils/math.`,
            });
        },
      };
    },
  },
};

/** @type {import("eslint").ESLint.Plugin} */
export const ratchetPlugin = {
  rules: {
    ...customRules,
    "no-jsx-iife": selectorRule(
      "No immediately-invoked function inside JSX.",
      "JSXExpressionContainer CallExpression[callee.type=/^(ArrowFunctionExpression|FunctionExpression)$/]",
      "Immediately-invoked function in JSX. Compute the value above the return, or in a <component>.model.ts beside the component.",
    ),
    "no-config-reach-through": selectorRule(
      "An account-type field with its own helper is read through the helper.",
      `MemberExpression[property.name=/^(${HELPER_FIELDS})$/]:matches([object.callee.name='getAccountTypeConfig'], [object.object.name='ACCOUNT_TYPE_CONFIG'])`,
      "Read this account-type field through its helper in lib/config/account-types.ts (isOverflowTarget, getLimitGroup, isQcdEligible, …), not the config entry.",
    ),
    "no-string-closed-set-field": selectorRule(
      "A field holding a closed set's value is typed by the set, not string.",
      `TSPropertySignature[key.name=/^(${CLOSED_SET_FIELDS})$/] > TSTypeAnnotation > TSStringKeyword`,
      "This field holds a closed set's value: type it by the set (AccountCategory, PortfolioTaxType, ReturnFilingStatus, …), not string.",
    ),
    "no-raw-button": selectorRule(
      "Buttons go through the Button primitive.",
      "JSXOpeningElement[name.name='button']",
      "Raw <button>. Use Button from @/components/ui/button where its look matches.",
    ),
    "no-raw-tablist": selectorRule(
      "Tabs and radio groups go through the ui primitives.",
      "JSXAttribute[name.name='role'][value.value=/^(tab|tablist|radiogroup)$/]",
      "Hand-built tab strip or radio group. Use the Tabs or SegmentedControl primitive in @/components/ui.",
    ),
    "no-hand-date-format": selectorRule(
      "Dates are formatted by formatDate.",
      "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]",
      "Hand date format. Use formatDate from @/lib/utils/format.",
    ),
    "no-raw-chart-container": selectorRule(
      "Charts sit in the chart primitives.",
      "JSXOpeningElement[name.name='ResponsiveContainer']",
      "ResponsiveContainer outside components/charts. Charts go through the chart primitives there.",
    ),
    "no-raw-input": selectorRule(
      "Inputs go through the form primitives.",
      "JSXOpeningElement[name.name='input']",
      "Raw <input>. Use FormInput from @/components/forms or a primitive in @/components/ui.",
    ),
    "no-text-includes": {
      meta: {
        type: "suggestion",
        docs: { description: "Nothing branches on human-readable text." },
        schema: [],
      },
      create(context) {
        return {
          "CallExpression[callee.property.name='includes']"(node) {
            if (!isStringLiteral(node.arguments[0])) return;
            const name = sourceName(node.callee.object);
            if (name && TEXT_FIELD.test(name))
              context.report({
                node,
                message: `.includes() on the text field '${name}'. Branch on a fact the engine emits (an enum, flag or id), never on its wording.`,
              });
          },
        };
      },
    },
    "no-fixed-inset-overlay": {
      meta: {
        type: "suggestion",
        docs: { description: "Overlays go through the ui primitives." },
        schema: [],
      },
      create(context) {
        const message =
          "Hand-built overlay (`fixed inset-0`). Use ConfirmDialog, SlidePanel or another primitive in @/components/ui.";
        return {
          Literal(node) {
            if (typeof node.value === "string" && isOverlayClasses(node.value))
              context.report({ node, message });
          },
          TemplateLiteral(node) {
            const text = node.quasis.map((q) => q.value.cooked ?? "").join(" ");
            if (isOverlayClasses(text)) context.report({ node, message });
          },
        };
      },
    },
  },
};

export const ratchetConfig = [
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { ratchet: ratchetPlugin },
    rules: {
      "max-lines-per-function": ["error", { max: 150, IIFEs: true }],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "ratchet/no-jsx-iife": "error",
      "ratchet/no-text-includes": "error",
      "ratchet/no-raw-input": "error",
      // Owner Q4 (v0.10.4): counted before the UI work lowers them.
      "ratchet/no-raw-button": "error",
      "ratchet/no-unlabeled-control": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "ratchet/no-raw-tablist": "error",
      "ratchet/no-hand-date-format": "error",
      "ratchet/no-raw-chart-container": "error",
      "ratchet/no-string-closed-set-field": "error",
      "ratchet/no-config-reach-through": "error",
      "ratchet/no-fixed-inset-overlay": "error",
      "ratchet/no-history-comment": "error",
      "ratchet/max-comment-lines": "error",
      "ratchet/no-stacked-docblock": "error",
      "ratchet/no-guarded-division": "error",
    },
  },
  {
    // The helpers themselves.
    files: ["src/lib/config/account-types.ts"],
    rules: { "ratchet/no-config-reach-through": "off" },
  },
  {
    // The primitives themselves.
    files: ["src/components/forms/**", "src/components/ui/**"],
    rules: { "ratchet/no-raw-input": "off" },
  },
  {
    // The overlay primitives themselves.
    files: [
      "src/components/ui/modal.tsx",
      "src/components/ui/slide-panel.tsx",
      "src/components/ui/popover.tsx",
    ],
    rules: { "ratchet/no-fixed-inset-overlay": "off" },
  },
  {
    // The button, tab and segment primitives themselves.
    files: ["src/components/ui/**"],
    rules: {
      "ratchet/no-raw-button": "off",
      "ratchet/no-raw-tablist": "off",
    },
  },
  {
    // formatDate itself.
    files: ["src/lib/utils/format.ts"],
    rules: { "ratchet/no-hand-date-format": "off" },
  },
  {
    // The chart primitives.
    files: ["src/components/charts/**"],
    rules: { "ratchet/no-raw-chart-container": "off" },
  },
];
