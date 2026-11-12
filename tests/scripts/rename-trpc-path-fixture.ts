/**
 * An invented app for scripts/rename-trpc-path.ts: a `gadgets` router whose
 * `listContribRows` abbreviates, a client, a test, a pinned baseline file, a
 * doc and the ratchet files the script keeps. The script (and the size
 * ratchet it runs) are symlinks to this repo's; the generated-docs steps are
 * stubs, so a run never writes outside the fixture.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const SCRIPT = path.join(REPO, "scripts/rename-trpc-path.ts");

export const RENAME_MESSAGE = `refactor(gadgets)!: the abbreviated gadget list says its word

Fixture commit.

API: gadgets.listContribRows → gadgets.listContributionRows
Visible: none
Baseline-rerecord: __baseline__/*/gadgets.listContributionRows.json — none, AR9: rename-only re-record, each file its old file renamed
Rename-path: gadgets.listContribRows → gadgets.listContributionRows
`;

/** A line prettier keeps on one line before the rename and wraps after it. */
const CLIENT = `import { trpc } from "@/lib/trpc";

export function GadgetList() {
  const rows = trpc.gadgets.listContribRows.useQuery({ householdId: 1, y: 2 });
  const utils = trpc.useUtils();
  const refresh = () => utils.gadgets.listContribRows.invalidate();
  return { rows, refresh };
}
`;

const FILES: Record<string, string> = {
  ".gitignore": "node_modules\n",
  "package.json": '{ "name": "fixture", "private": true }\n',
  "src/server/routers/index.ts": `import { createTRPCRouter } from "../trpc";
import { gadgetsRouter } from "./gadgets";

export const appRouter = createTRPCRouter({
  gadgets: gadgetsRouter,
});
`,
  "src/server/routers/gadgets.ts": `import { createTRPCRouter, protectedProcedure } from "../trpc";

export const gadgetsRouter = createTRPCRouter({
  /** The gadget rows, by contribution. */
  listContribRows: protectedProcedure.query(() => []),
  computeTotal: protectedProcedure.query(() => 0),
});
`,
  "src/components/gadget-list.tsx": CLIENT,
  "tests/gadgets.test.ts": `const PATHS = ["gadgets.listContribRows", "gadgets.computeTotal"];\nexport default PATHS;\n`,
  "tests/baseline/__baseline__/h1/gadgets.listContribRows.json": "[]\n",
  "docs/GADGETS.md": "# Gadgets\n\nThe list is `gadgets.listContribRows`.\n",
  "eslint-suppressions.json": `${JSON.stringify(
    {
      "src/server/routers/gadgets.ts": {
        "ratchet/no-abbreviation": { count: 2 },
      },
    },
    null,
    2,
  )}\n`,
  "size-baseline.json": `${JSON.stringify(
    {
      files: {
        "src/components/gadget-list.tsx": CLIENT.split("\n").length - 1,
      },
      functions: {},
    },
    null,
    2,
  )}\n`,
  "docs/API_ROUTERS.md": "# Routers\n",
  "docs/SCHEMA.md": "# Schema\n",
  "scripts/gen-api-docs.ts": "export {};\n",
  "scripts/verify-docs.ts": "export {};\n",
};

export type Fixture = {
  dir: string;
  git: (...args: string[]) => string;
  /** Runs the script in the fixture with the message's trailers. */
  rename: (message?: string) => string;
  read: (file: string) => string;
  remove: () => void;
};

export function makeFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "ledgr-rename-path-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  for (const [file, text] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  fs.symlinkSync(SCRIPT, path.join(dir, "scripts/rename-trpc-path.ts"));
  fs.symlinkSync(
    path.join(REPO, "scripts/check-size-baseline.ts"),
    path.join(dir, "scripts/check-size-baseline.ts"),
  );
  fs.symlinkSync(
    fs.realpathSync(path.join(REPO, "node_modules")),
    path.join(dir, "node_modules"),
  );
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", "/dev/null");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: the fixture\n\nThe invented app.");
  const messageFile = path.join(dir, ".git", "rename-message.txt");
  return {
    dir,
    git,
    rename: (message = RENAME_MESSAGE) => {
      fs.writeFileSync(messageFile, message);
      return execFileSync(
        "npx",
        ["tsx", "scripts/rename-trpc-path.ts", "--message", messageFile],
        { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    },
    read: (file) => fs.readFileSync(path.join(dir, file), "utf8"),
    remove: () => {
      try {
        git("worktree", "prune");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}
