/**
 * Acceptance criterion 12 (v0.7.8 penalty-hard-exclusion pass — see
 * .scratch/docs/plans/DESIGN-DECISION-v0.7.8-penalty-hard-exclusion.md):
 * "No third definition." Two checks:
 *
 *   A. `PENALTY_FREE_AGE`, `HSA_NON_MEDICAL_PENALTY_AGE`,
 *      `EARLY_WITHDRAWAL_PENALTY_RATE`, and `HSA_NON_MEDICAL_PENALTY_RATE`
 *      each have exactly ONE `export const` definition in the whole
 *      codebase (src/lib/constants.ts) — a static scan, not a runtime
 *      assertion, since the failure mode is a second copy existing at all.
 *   B. The exposure verdict this pass's NEW code computes
 *      (`computeWithdrawalEligibility`'s `penaltyFreeAmount`) agrees
 *      slice-for-slice with `early-access.ts`'s own slice output for the
 *      same inputs — proving `withdrawal-eligibility.ts` derives its
 *      verdict FROM early-access.ts rather than re-deriving its own
 *      age/rate logic that could silently drift from it.
 *
 * Pre-existing literal `59.5` / "Locked until age 59½" UI reason-text
 * checks in withdrawal-eligibility.ts predate this pass (Group 2.2) and
 * are reason-string wording, not eligibility math — out of scope here;
 * check A only guards the four named CONSTANTS, not every literal.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  computeWithdrawalEligibility,
  type EligibilityAccountInput,
} from "@/lib/pure/withdrawal-eligibility";
import {
  computeRothIraAccess,
  computeEmployerPlanPreTaxAccess,
  computeHsaAccess,
} from "@/lib/pure/early-access";

const SRC_ROOT = path.resolve(__dirname, "../../src");

function* walkTsFiles(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      yield* walkTsFiles(full);
    } else if (e.isFile() && /\.tsx?$/.test(e.name)) {
      yield full;
    }
  }
}

function countExportConstDefinitions(constName: string): {
  count: number;
  files: string[];
} {
  const re = new RegExp(`export const ${constName}\\b`);
  const files: string[] = [];
  for (const file of walkTsFiles(SRC_ROOT)) {
    const content = fs.readFileSync(file, "utf8");
    if (re.test(content)) {
      files.push(path.relative(SRC_ROOT, file));
    }
  }
  return { count: files.length, files };
}

describe("criterion 12A: no second definition of the four penalty constants", () => {
  it.each([
    "PENALTY_FREE_AGE",
    "HSA_NON_MEDICAL_PENALTY_AGE",
    "EARLY_WITHDRAWAL_PENALTY_RATE",
    "HSA_NON_MEDICAL_PENALTY_RATE",
  ])("%s is exported from exactly one file", (constName) => {
    const { count, files } = countExportConstDefinitions(constName);
    expect(files).toEqual(["lib/constants.ts"]);
    expect(count).toBe(1);
  });
});

describe("criterion 12B: exposure verdict agrees slice-for-slice with early-access.ts", () => {
  const indKey = (ia: {
    name: string;
    category: string;
    taxType: string;
    ownerPersonId?: number;
  }) =>
    `${ia.name}::${ia.category}::${ia.taxType}::${ia.ownerPersonId ?? "joint"}`;

  it("Roth IRA (basis_first): penaltyFreeAmount === the sum of computeRothIraAccess's own leading penalty-free slices", () => {
    const ia: EligibilityAccountInput = {
      name: "Roth IRA",
      category: "ira",
      taxType: "taxFree",
      ownerPersonId: 1,
      ownerBirthYear: 1995,
      rothBasisMeta: {
        year: 2024,
        contributionBasis: 30000,
        conversionBasis: 0,
        latestConversionYear: null,
        isSeeded: false,
        updatedAt: new Date("2024-01-01"),
      },
    };
    const balance = 120000;
    const year = 2026;
    const currentAge = 2026 - 1995;

    const record = computeWithdrawalEligibility({
      year,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), balance]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;

    const slices = computeRothIraAccess({
      balance,
      currentAge,
      currentYear: year,
      contributionBasis: 30000,
      conversionBasis: 0,
      latestConversionYear: null,
    });
    let expectedPenaltyFree = 0;
    for (const s of slices) {
      if (!s.penaltyFree) break;
      expectedPenaltyFree += s.amount;
    }
    expect(entry.penaltyFreeAmount).toBeCloseTo(expectedPenaltyFree, 2);
  });

  it("401k (pro_rata): penaltyFreeAmount === the sum of computeEmployerPlanPreTaxAccess's own leading penalty-free slices", () => {
    const ia: EligibilityAccountInput = {
      name: "401k",
      category: "401k",
      taxType: "preTax",
      ownerPersonId: 1,
      ownerBirthYear: 1990,
    };
    const balance = 400000;
    const year = 2026;
    const currentAge = 2026 - 1990;

    const record = computeWithdrawalEligibility({
      year,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), balance]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;

    const slices = computeEmployerPlanPreTaxAccess(balance, currentAge, false);
    let expectedPenaltyFree = 0;
    for (const s of slices) {
      if (!s.penaltyFree) break;
      expectedPenaltyFree += s.amount;
    }
    expect(entry.penaltyFreeAmount).toBeCloseTo(expectedPenaltyFree, 2);
  });

  it("HSA: penaltyFreeAmount === the sum of computeHsaAccess's own leading penalty-free slices", () => {
    const ia: EligibilityAccountInput = {
      name: "HSA",
      category: "hsa",
      taxType: "preTax",
      ownerPersonId: 1,
      ownerBirthYear: 1985,
    };
    const balance = 60000;
    const year = 2026;
    const currentAge = 2026 - 1985;

    const record = computeWithdrawalEligibility({
      year,
      indAccts: [ia],
      indBal: new Map([[indKey(ia), balance]]),
      indKey,
    });
    const entry = record.byKey.get(indKey(ia))!;

    const slices = computeHsaAccess(balance, currentAge);
    let expectedPenaltyFree = 0;
    for (const s of slices) {
      if (!s.penaltyFree) break;
      expectedPenaltyFree += s.amount;
    }
    expect(entry.penaltyFreeAmount).toBeCloseTo(expectedPenaltyFree, 2);
  });
});
