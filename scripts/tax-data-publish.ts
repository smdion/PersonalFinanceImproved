/**
 * Publish the tax-data file as a signed release that installs can pick up
 * between Ledgr versions (the community sync). Run by the owner, locally —
 * the signing key never goes to CI (dependabot merges to main unreviewed).
 *
 * Checks, then signs and releases:
 *  - on main, a clean tree, and the file is byte-identical to origin/main;
 *  - the file passes every tax-data check;
 *  - its dataVersion is higher than every published tax-data release;
 *  - the signature verifies with a public key this code bundles.
 * Then `gh release create tax-data-v<N> --latest=false` with the file, its
 * signature, and a summary of the figures that changed since the last one.
 *
 * Usage: TAX_DATA_SIGNING_KEY_FILE=<pem> TAX_DATA_SIGNING_KEY_ID=<id> \
 *          pnpm tax-data:publish [--dry-run]
 *
 * Test release (before a merge): add `--test [--file <path>]` — any valid
 * file, from any branch, published as a pre-release `tax-data-test-vN`
 * that only a server with LEDGR_TAX_DATA_CHANNEL=test reads. Delete it
 * afterwards: `gh release delete tax-data-test-vN --cleanup-tag`.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  shippedReferenceRows,
  sameReferenceValue,
  type TaxDataFile,
} from "../src/lib/db/reference-reconcile-core";
import { validateTaxDataFile } from "../src/lib/tax-data/validate";
import {
  signTaxData,
  verifyTaxDataSignature,
} from "../src/lib/tax-data/signature";
import {
  TAX_DATA_TAG_PREFIX,
  TAX_DATA_TEST_TAG_PREFIX,
} from "../src/lib/config/tax-data-sync";

const FILE = "tax-data/us-federal.json";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
/** A test release: any valid file, from any branch, as a pre-release under
 *  the test prefix — read only by a server with LEDGR_TAX_DATA_CHANNEL=test. */
const test = args.includes("--test");
const fileArg = args.includes("--file")
  ? args[args.indexOf("--file") + 1]
  : undefined;
const prefix = test ? TAX_DATA_TEST_TAG_PREFIX : TAX_DATA_TAG_PREFIX;
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (fileArg && !test) fail("--file is for --test releases only.");
git("fetch", "--quiet", "--tags", "origin", "main");
let bytes: Buffer;
let sha: string | undefined;
if (test) {
  bytes = fs.readFileSync(fileArg ?? FILE);
} else {
  // 1. Exactly what's on main.
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main")
    fail("Run from main (or publish a --test release from a branch).");
  if (git("status", "--porcelain")) fail("The working tree isn't clean.");
  bytes = fs.readFileSync(FILE);
  const onMain = execFileSync("git", ["show", `origin/main:${FILE}`]);
  if (!bytes.equals(onMain))
    fail(`${FILE} differs from origin/main — merge it first.`);
  sha = git("rev-parse", "origin/main");
}

// 2. Valid.
const file = JSON.parse(bytes.toString("utf8")) as TaxDataFile;
const problems = validateTaxDataFile(file);
if (problems.length) fail(`The file has problems:\n  ${problems.join("\n  ")}`);

// 3. Newer than anything published on this channel (the remote's tags).
const published = git("ls-remote", "--tags", "origin", `${prefix}*`)
  .split("\n")
  .map((l) => l.split("refs/tags/")[1]?.replace(/\^\{\}$/, ""))
  .filter((t): t is string => !!t && t.startsWith(prefix))
  .map((t) => /^(\d+)$/.exec(t.slice(prefix.length))?.[1])
  .filter((n): n is string => !!n)
  .map(Number);
const last = published.length ? Math.max(...published) : 0;
if (file.dataVersion <= last)
  fail(
    `dataVersion ${file.dataVersion} isn't above the last release (${last}).`,
  );

// 4. Signed with a bundled key.
const keyFile = process.env.TAX_DATA_SIGNING_KEY_FILE;
const keyId = process.env.TAX_DATA_SIGNING_KEY_ID;
if (!keyFile || !keyId)
  fail("Set TAX_DATA_SIGNING_KEY_FILE and TAX_DATA_SIGNING_KEY_ID.");
const signature = JSON.stringify([
  signTaxData(bytes, fs.readFileSync(keyFile!, "utf8"), keyId!),
]);
if (!verifyTaxDataSignature(bytes, signature))
  fail(
    `The signature doesn't verify with the public keys in src/lib/config/tax-data-sync.ts (wrong key, or key ${keyId} isn't bundled yet).`,
  );

// 5. What changed since the last release (a test release: since the
//    file on this branch).
const before = test
  ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as TaxDataFile)
  : last
    ? (JSON.parse(git("show", `${prefix}${last}:${FILE}`)) as TaxDataFile)
    : null;
const prevRows = new Map(
  (before ? shippedReferenceRows(before) : []).map((r) => [
    `${r.table} ${r.keyVals.join(" ")}`,
    r,
  ]),
);
const changed = shippedReferenceRows(file).flatMap((r) => {
  const key = `${r.table} ${r.keyVals.join(" ")}`;
  const p = prevRows.get(key);
  if (!p) return [`- added ${key}`];
  return sameReferenceValue(p.value, r.value, r.json)
    ? []
    : [
        `- ${key}: ${r.json ? "updated" : `${String(p.value)} → ${String(r.value)}`}`,
      ];
});
const tag = `${prefix}${file.dataVersion}`;
const notes = [
  `Tax data, data version ${file.dataVersion} (${Object.keys(file.years).join(", ")}).`,
  "",
  test
    ? "TEST release — read only by a server with LEDGR_TAX_DATA_CHANNEL=test. Delete it after testing."
    : "Installs with community tax-data updates on see this as an update to review in Settings → Reference Data. Figures a household changed are never touched.",
  "",
  `Changed since ${test ? "the file on this branch" : last ? `${prefix}${last}` : "the first release"}:`,
  ...(changed.length ? changed : ["- notes only"]),
].join("\n");

console.log(
  `✓ ${test ? "test release" : `main @ ${sha!.slice(0, 8)}`}, valid, signed by ${keyId}`,
);
console.log(`\n${tag}\n\n${notes}\n`);
if (dryRun) {
  console.log("(dry run — nothing released)");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-data-"));
fs.writeFileSync(path.join(dir, "us-federal.json"), bytes);
fs.writeFileSync(path.join(dir, "us-federal.json.sig"), signature);
fs.writeFileSync(path.join(dir, "notes.md"), notes);
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--latest=false",
    ...(test ? ["--prerelease"] : ["--target", sha!]),
    "--title",
    `Tax data v${file.dataVersion}${test ? " (test)" : ""}`,
    "--notes-file",
    path.join(dir, "notes.md"),
    path.join(dir, "us-federal.json"),
    path.join(dir, "us-federal.json.sig"),
  ],
  { stdio: "inherit" },
);
fs.rmSync(dir, { recursive: true, force: true });
console.log(`✓ Released ${tag}`);
