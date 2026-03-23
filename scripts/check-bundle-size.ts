/**
 * Check client bundle sizes and warn/fail if they exceed thresholds.
 * Run after `ANALYZE=true pnpm build` to inspect .next/analyze/*.html reports.
 * This script checks raw JS file sizes in .next/static/chunks/.
 */
import * as fs from "fs";
import * as path from "path";

const WARN_KB = 250; // Warn if any single chunk exceeds 250 KB
const ERROR_KB = 500; // Fail if any single chunk exceeds 500 KB
const TOTAL_WARN_KB = 1500; // Warn if total first-load JS exceeds 1.5 MB
const TOTAL_ERROR_KB = 3000; // Fail if total first-load JS exceeds 3 MB

const chunksDir = path.join(process.cwd(), ".next", "static", "chunks");

if (!fs.existsSync(chunksDir)) {
  console.log("No .next/static/chunks/ found — run `pnpm build` first.");
  process.exit(0);
}

const files = fs.readdirSync(chunksDir).filter((f) => f.endsWith(".js"));

let totalBytes = 0;
let warnings = 0;
let errors = 0;

const results: { name: string; kb: number; status: string }[] = [];

for (const file of files) {
  const fullPath = path.join(chunksDir, file);
  const stat = fs.statSync(fullPath);
  const kb = Math.round(stat.size / 1024);
  totalBytes += stat.size;

  let status = "OK";
  if (kb > ERROR_KB) {
    status = "ERROR";
    errors++;
  } else if (kb > WARN_KB) {
    status = "WARN";
    warnings++;
  }

  if (status !== "OK") {
    results.push({ name: file, kb, status });
  }
}

const totalKb = Math.round(totalBytes / 1024);

console.log(`Bundle size check:`);
console.log(`  Total JS chunks: ${files.length} files, ${totalKb} KB`);
console.log(
  `  Thresholds: chunk warn=${WARN_KB}KB error=${ERROR_KB}KB, total warn=${TOTAL_WARN_KB}KB error=${TOTAL_ERROR_KB}KB`,
);
console.log("");

if (results.length > 0) {
  console.log("Large chunks:");
  for (const r of results) {
    console.log(`  [${r.status}] ${r.name}: ${r.kb} KB`);
  }
  console.log("");
}

if (totalKb > TOTAL_ERROR_KB) {
  console.log(
    `ERROR: Total bundle size ${totalKb} KB exceeds ${TOTAL_ERROR_KB} KB limit`,
  );
  errors++;
} else if (totalKb > TOTAL_WARN_KB) {
  console.log(
    `WARN: Total bundle size ${totalKb} KB exceeds ${TOTAL_WARN_KB} KB threshold`,
  );
  warnings++;
}

if (errors > 0) {
  console.log(`\n${errors} error(s), ${warnings} warning(s) — FAIL`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\n${warnings} warning(s) — PASS (with warnings)`);
} else {
  console.log("All chunks within limits — PASS");
}
