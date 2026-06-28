/**
 * One-shot importer for the House Upkeep utilities tabs (Gas / Water & Sewer /
 * Electric) into the utility_service + utility_reading tables.
 *
 * The spreadsheet is a wide matrix: A1 = provider, row 1 = year headers (each
 * year spans two columns: cost then usage), rows 3-14 = months Jan-Dec read by
 * LABEL (not position), and a derived summary block below (ignored). Some cells
 * are cost-only (e.g. gas in the 2018 move-in year) — usage is stored null.
 *
 * The parse step (`parseUtilityMatrix`) is a pure function so it can be unit
 * tested; all I/O (xlsx read, db writes) lives in `main()`.
 *
 * Run:
 *   pnpm tsx scripts/import-utilities.ts --dry-run   # parse + print, no writes
 *   pnpm tsx scripts/import-utilities.ts             # idempotent upsert
 */
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import type { UtilityKind, UtilityUnit } from "@/lib/config/enum-values";

// NOTE: `@/lib/db` (which opens a DB connection on import) is imported lazily
// inside main() so that unit tests can import the pure `parseUtilityMatrix`
// without triggering a database connection.

const XLSX_PATH = ".scratch/data/House Upkeep.xlsx";

/** Spreadsheet tab → utility kind. */
export const SHEETS: { tab: string; kind: UtilityKind }[] = [
  { tab: "Gas", kind: "gas" },
  { tab: "Water & Sewer", kind: "water" },
  { tab: "Electric", kind: "electric" },
];

/** Seed usage unit per kind. */
export const USAGE_UNIT_BY_KIND: Record<UtilityKind, UtilityUnit> = {
  gas: "ccf",
  water: "gallon",
  electric: "kWh",
};

/** Month label → month number (1-12). Accepts the label drift in the sheet. */
export const MONTH_LABEL_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export type NormalizedReading = {
  year: number;
  month: number;
  cost: string;
  usage: string | null;
};

export type ParseResult = {
  providerName: string;
  rows: NormalizedReading[];
  warnings: string[];
};

function isEmpty(v: unknown): boolean {
  return (
    v === null || v === undefined || (typeof v === "string" && v.trim() === "")
  );
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? NaN : n;
}

/**
 * Parse one utility tab matrix (rows of cells, header:1 form) into normalized
 * readings. Pure — no I/O. Throws on a malformed sheet (missing provider, an
 * unrecognized month label) so spreadsheet drift surfaces loudly.
 */
export function parseUtilityMatrix(
  matrix: unknown[][],
  kind: UtilityKind,
): ParseResult {
  const header = matrix[0] ?? [];
  const providerName = isEmpty(header[0]) ? "" : String(header[0]).trim();
  if (!providerName) {
    throw new Error(`[${kind}] missing provider name in cell A1`);
  }

  // Derive year columns from row 1: a numeric year header occupies the cost
  // column; the following column is its usage. Non-year cells (e.g. "Avg Cost")
  // are skipped.
  const yearCols: { year: number; costCol: number; usageCol: number }[] = [];
  for (let c = 1; c < header.length; c++) {
    const v = header[c];
    if (
      typeof v === "number" &&
      Number.isInteger(v) &&
      v >= 1900 &&
      v <= 2100
    ) {
      yearCols.push({ year: v, costCol: c, usageCol: c + 1 });
    }
  }
  if (yearCols.length === 0) {
    throw new Error(`[${kind}] no year columns found in row 1`);
  }

  const rows: NormalizedReading[] = [];
  const warnings: string[] = [];

  // Month block starts at row 3 (index 2) and is contiguous; the first blank
  // label row ends it (the derived summary block below is never reached).
  for (let r = 2; r < matrix.length; r++) {
    const label = matrix[r]?.[0];
    if (isEmpty(label)) break;
    const month = MONTH_LABEL_MAP[String(label).trim().toLowerCase()];
    if (!month) {
      throw new Error(
        `[${kind}] unrecognized month label "${String(label)}" in row ${r + 1}`,
      );
    }

    for (const { year, costCol, usageCol } of yearCols) {
      const costRaw = matrix[r]?.[costCol];
      const usageRaw = matrix[r]?.[usageCol];
      const hasCost = !isEmpty(costRaw);
      const hasUsage = !isEmpty(usageRaw);

      if (!hasCost && !hasUsage) continue; // empty cell pair — skip

      if (!hasCost && hasUsage) {
        warnings.push(
          `[${kind}] ${year}-${String(month).padStart(2, "0")}: usage present but no cost — skipped`,
        );
        continue;
      }

      const cost = toNum(costRaw);
      if (isNaN(cost)) {
        warnings.push(
          `[${kind}] ${year}-${String(month).padStart(2, "0")}: non-numeric cost ${JSON.stringify(costRaw)} — skipped`,
        );
        continue;
      }

      let usage: string | null = null;
      if (hasUsage) {
        const u = toNum(usageRaw);
        if (isNaN(u)) {
          warnings.push(
            `[${kind}] ${year}-${String(month).padStart(2, "0")}: non-numeric usage ${JSON.stringify(usageRaw)} — stored null`,
          );
        } else {
          usage = u.toFixed(4);
        }
      }

      rows.push({ year, month, cost: cost.toFixed(2), usage });
    }
  }

  return { providerName, rows, warnings };
}

function printDryRun(kind: UtilityKind, result: ParseResult): void {
  const byYear = new Map<number, number>();
  let nullUsage = 0;
  for (const row of result.rows) {
    byYear.set(row.year, (byYear.get(row.year) ?? 0) + 1);
    if (row.usage === null) nullUsage++;
  }
  console.log(
    `\n[${kind}] provider="${result.providerName}" unit=${USAGE_UNIT_BY_KIND[kind]} — ${result.rows.length} readings (${nullUsage} cost-only)`,
  );
  for (const year of Array.from(byYear.keys()).sort((a, b) => a - b)) {
    console.log(`    ${year}: ${byYear.get(year)} months`);
  }
  for (const w of result.warnings) console.log(`    WARN ${w}`);
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const wb = XLSX.readFile(XLSX_PATH);

  // Lazy — only open a DB connection when we are actually writing.
  const { db } = dryRun ? { db: null as never } : await import("@/lib/db");
  const schema = dryRun ? (null as never) : await import("@/lib/db/schema");

  for (const { tab, kind } of SHEETS) {
    const ws = wb.Sheets[tab];
    if (!ws) throw new Error(`Sheet "${tab}" not found in ${XLSX_PATH}`);
    const matrix: unknown[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: true,
    });

    const result = parseUtilityMatrix(matrix, kind);

    if (dryRun) {
      printDryRun(kind, result);
      continue;
    }

    // Upsert service by kind (unique), capture id.
    await db
      .insert(schema.utilityService)
      .values({
        kind,
        providerName: result.providerName,
        usageUnit: USAGE_UNIT_BY_KIND[kind],
        sortOrder: SHEETS.findIndex((s) => s.kind === kind),
      })
      .onConflictDoUpdate({
        target: [schema.utilityService.kind],
        set: {
          providerName: result.providerName,
          usageUnit: USAGE_UNIT_BY_KIND[kind],
        },
      });
    const svc = (
      await db
        .select()
        .from(schema.utilityService)
        .where(eq(schema.utilityService.kind, kind))
    )[0]!;

    // Upsert readings on (serviceId, year, month) — re-running is a no-op.
    for (const row of result.rows) {
      await db
        .insert(schema.utilityReading)
        .values({
          serviceId: svc.id,
          year: row.year,
          month: row.month,
          cost: row.cost,
          usage: row.usage,
        })
        .onConflictDoUpdate({
          target: [
            schema.utilityReading.serviceId,
            schema.utilityReading.year,
            schema.utilityReading.month,
          ],
          set: { cost: row.cost, usage: row.usage },
        });
    }

    for (const w of result.warnings) console.log(`WARN ${w}`);
    console.log(
      `[${kind}] imported ${result.rows.length} readings for "${result.providerName}".`,
    );
  }

  console.log(
    dryRun ? "\nDry run complete — no writes." : "\nImport complete.",
  );
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].includes("import-utilities")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
