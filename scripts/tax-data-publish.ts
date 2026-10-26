/**
 * Publish the tax-data file to the project's tax-data release, which
 * installs with tax data updates on pick up between Ledgr versions (an
 * admin reviews it first). One rolling release — tag `tax-data`, no
 * version in its name — replaced in place each time; its one asset is the
 * file and its signature together. Run by the owner, locally: the signing
 * key never goes to CI (dependabot merges to main unreviewed).
 *
 * Checks, then signs and publishes:
 *  - on main, a clean tree, and the file is byte-identical to origin/main;
 *  - the file passes every tax-data check;
 *  - it's newer (its dataVersion counter) than what the release holds;
 *  - the signature verifies with a public key this code bundles.
 *
 * Usage: TAX_DATA_SIGNING_KEY_FILE=<pem> TAX_DATA_SIGNING_KEY_ID=<id> \
 *          pnpm tax-data:publish [--dry-run]
 *
 * Trying a change before it's merged: add `--test [--file <path>]` — any
 * valid file, from any branch, to the separate `tax-data-test` pre-release
 * that only a server with LEDGR_TAX_DATA_CHANNEL=test reads. Delete it
 * afterwards: `gh release delete tax-data-test --cleanup-tag`.
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
  packSignedTaxData,
  signTaxData,
  unpackSignedTaxData,
  verifyTaxDataSignature,
} from "../src/lib/tax-data/signature";
import {
  TAX_DATA_ASSET,
  TAX_DATA_RELEASE_TAG,
  TAX_DATA_TEST_RELEASE_TAG,
} from "../src/lib/config/tax-data-sync";

const FILE = "tax-data/us-federal.json";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const test = args.includes("--test");
const fileArg = args.includes("--file")
  ? args[args.indexOf("--file") + 1]
  : undefined;
const tag = test ? TAX_DATA_TEST_RELEASE_TAG : TAX_DATA_RELEASE_TAG;

const run = (cmd: string, ...a: string[]) =>
  execFileSync(cmd, a, { encoding: "utf8" }).trim();
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// 1. What to publish: exactly what's on main (or, for a test, any file).
if (fileArg && !test) fail("--file is for --test releases only.");
run("git", "fetch", "--quiet", "origin", "main");
let bytes: Buffer;
let sha: string | undefined;
if (test) {
  bytes = fs.readFileSync(fileArg ?? FILE);
} else {
  if (run("git", "rev-parse", "--abbrev-ref", "HEAD") !== "main")
    fail("Run from main (or publish a --test release from a branch).");
  if (run("git", "status", "--porcelain"))
    fail("The working tree isn't clean.");
  bytes = fs.readFileSync(FILE);
  if (!bytes.equals(execFileSync("git", ["show", `origin/main:${FILE}`])))
    fail(`${FILE} differs from origin/main — merge it first.`);
  sha = run("git", "rev-parse", "origin/main");
}

// 2. Valid.
const file = JSON.parse(bytes.toString("utf8")) as TaxDataFile;
const problems = validateTaxDataFile(file);
if (problems.length) fail(`The file has problems:\n  ${problems.join("\n  ")}`);

// 3. Newer than what the release holds now.
let releaseExists = true;
let published: TaxDataFile | null = null;
try {
  const asset = execFileSync(
    "gh",
    ["release", "download", tag, "--pattern", TAX_DATA_ASSET, "--output", "-"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const unpacked = unpackSignedTaxData(asset);
  if (unpacked) published = JSON.parse(unpacked.fileText) as TaxDataFile;
} catch {
  releaseExists = false;
}
if (published && file.dataVersion <= published.dataVersion)
  fail(
    "The release already holds this file or a newer one — raise dataVersion in the file.",
  );

// 4. Signed with a bundled key.
const keyFile = process.env.TAX_DATA_SIGNING_KEY_FILE;
const keyId = process.env.TAX_DATA_SIGNING_KEY_ID;
if (!keyFile || !keyId)
  fail("Set TAX_DATA_SIGNING_KEY_FILE and TAX_DATA_SIGNING_KEY_ID.");
const signatures = [
  signTaxData(bytes, fs.readFileSync(keyFile!, "utf8"), keyId!),
];
if (!verifyTaxDataSignature(bytes, JSON.stringify(signatures)))
  fail(
    `The signature doesn't verify with the public keys in src/lib/config/tax-data-sync.ts (wrong key, or key ${keyId} isn't bundled yet).`,
  );

// 5. What changed since the release (a first test: since this branch's file).
const before =
  published ??
  (test ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as TaxDataFile) : null);
const prevRows = new Map(
  (before ? shippedReferenceRows(before) : []).map((r) => [
    `${r.table} ${r.keyVals.join(" ")}`,
    r,
  ]),
);
const changed = shippedReferenceRows(file).flatMap((r) => {
  const key = `${r.table} ${r.keyVals.join(" ")}`;
  const p = prevRows.get(key);
  if (!p) return before ? [`- added ${key}`] : [];
  return sameReferenceValue(p.value, r.value, r.json)
    ? []
    : [
        `- ${key}: ${r.json ? "updated" : `${String(p.value)} → ${String(r.value)}`}`,
      ];
});
const today = new Date().toISOString().slice(0, 10);
const notes = [
  `Tax data for ${Object.keys(file.years).join(", ")} — published ${today}.`,
  "",
  test
    ? "TEST release — read only by a server with LEDGR_TAX_DATA_CHANNEL=test. Delete it after testing."
    : "Installs with tax data updates on see this as an update to review in Settings → Reference Data. Figures a household changed are never touched.",
  "",
  ...(before
    ? [
        "Changed since the last publish:",
        ...(changed.length ? changed : ["- notes only"]),
      ]
    : ["First publish."]),
].join("\n");

console.log(
  `✓ ${test ? "test release" : `main @ ${sha!.slice(0, 8)}`}, valid, signed by ${keyId}`,
);
console.log(`\n${tag} (${releaseExists ? "replace" : "create"})\n\n${notes}\n`);
if (dryRun) {
  console.log("(dry run — nothing published)");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-data-"));
const assetPath = path.join(dir, TAX_DATA_ASSET);
fs.writeFileSync(
  assetPath,
  packSignedTaxData(bytes.toString("utf8"), signatures),
);
fs.writeFileSync(path.join(dir, "notes.md"), notes);
const title = test ? "Tax data (test)" : "Tax data";
if (releaseExists) {
  run("gh", "release", "upload", tag, assetPath, "--clobber");
  run(
    "gh",
    "release",
    "edit",
    tag,
    "--title",
    title,
    "--notes-file",
    path.join(dir, "notes.md"),
  );
} else {
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--latest=false",
      ...(test ? ["--prerelease"] : ["--target", sha!]),
      "--title",
      title,
      "--notes-file",
      path.join(dir, "notes.md"),
      assetPath,
    ],
    { stdio: "inherit" },
  );
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`✓ Published ${tag}`);
