// Ratchet rules (docs/RULES.md § Refactoring): each is an error, today's
// cases are counted per file in eslint-suppressions.json, and a count only
// goes down (`npx eslint <files> --prune-suppressions` after a cleanup).
// One rule id per pattern, so a file can't trade one pattern for another.

const TEXT_FIELD =
  /(?:reason|label|message|note|description|warning|text|name|title|explanation|summary|detail)s?$/i;
const STRING_TRANSFORMS = new Set(["toLowerCase", "toUpperCase", "trim"]);

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

const ratchetPlugin = {
  rules: {
    "no-jsx-iife": selectorRule(
      "No immediately-invoked function inside JSX.",
      "JSXExpressionContainer CallExpression[callee.type=/^(ArrowFunctionExpression|FunctionExpression)$/]",
      "Immediately-invoked function in JSX. Compute the value above the return, or in a <component>.model.ts beside the component.",
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
      "ratchet/no-fixed-inset-overlay": "error",
    },
  },
  {
    // The primitives themselves.
    files: ["src/components/forms/**", "src/components/ui/**"],
    rules: {
      "ratchet/no-raw-input": "off",
      "ratchet/no-fixed-inset-overlay": "off",
    },
  },
];
