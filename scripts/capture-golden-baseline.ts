/**
 * Stage B safety-gate script (see .claude/plans, "One rule for every
 * profile"): captures a diffable golden-output fixture — resolved net pay
 * per check for every real job, per-account annual contribution totals,
 * every deduction line, the complete `savings_planned_transactions
 * WHERE source='rule'` set, and the selected tax-bracket row per person's
 * retirement projection — run once BEFORE Stage B's migration and once
 * AFTER, then diffed byte-for-byte. Not committed to the repo; a local
 * verification artifact only (real household financial data).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/capture-golden-baseline.ts --out <file>
 */
import * as fs from "fs";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { createCallerFactory } from "@/server/trpc";
import { appRouter } from "@/server/routers";
import type { Session } from "next-auth";
import { defaultDecumulationConfig } from "@/lib/config/account-types";

const adminSession: Session = {
  user: {
    id: "golden-baseline-script",
    name: "Golden Baseline Script",
    email: "script@local",
    role: "admin",
    permissions: [],
  },
  expires: "2099-12-31T23:59:59.999Z",
};

async function main() {
  const outArgIdx = process.argv.indexOf("--out");
  const outPath = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : undefined;
  if (!outPath) {
    console.error("Usage: tsx scripts/capture-golden-baseline.ts --out <file>");
    process.exit(1);
  }

  const callerFactory = createCallerFactory(appRouter);
  const caller = callerFactory({ db, session: adminSession, demoSchema: null });

  console.log("Resolving globally-active profile ids...");
  const activeContribSetting = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "active_contrib_profile_id"));
  const activeSalarySetting = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "active_salary_profile_id"));
  const contributionProfileId = activeContribSetting[0]?.value as
    number | undefined;
  const salaryProfileId = activeSalarySetting[0]?.value as number | undefined;
  console.log(
    `  contributionProfileId=${contributionProfileId} salaryProfileId=${salaryProfileId}`,
  );

  console.log("Capturing paycheck.computeSummary()...");
  const paycheckSummary = await caller.paycheck.computeSummary({
    contributionProfileId,
    salaryProfileId,
  });

  console.log(
    "Capturing per-person retirement projections + bracket selection...",
  );
  const people = await db.select().from(schema.people);
  const retirementByPerson: Record<string, unknown> = {};
  for (const p of people) {
    try {
      const settings = await db
        .select()
        .from(schema.retirementSettings)
        .where(eq(schema.retirementSettings.personId, p.id));
      retirementByPerson[String(p.id)] = {
        name: p.name,
        filingStatus: settings[0]?.filingStatus ?? null,
      };
    } catch (e) {
      retirementByPerson[String(p.id)] = { name: p.name, error: String(e) };
    }
  }

  // The actual projection output.
  //
  // This file's header has always claimed to capture "the selected
  // tax-bracket row per person's retirement projection", but the loop above
  // only ever recorded name + filing status — it never ran the engine. That
  // made the whole gate structurally incapable of detecting a change in
  // projected numbers, which is precisely what it exists to catch (found
  // 2026-08-30, by perturbing the engine's inputs and watching the "gate"
  // stay green).
  //
  // Captures the year-by-year engine output plus the headline scalars. Not
  // the whole response: percentile bands and other Monte Carlo fields carry
  // a random seed and would make every run differ. calculateProjection is
  // deterministic, so this diffs cleanly.
  console.log("Capturing computeProjection() engine output...");
  let projection: unknown;
  try {
    const res = await caller.projection.computeProjection({
      decumulationDefaults: defaultDecumulationConfig(),
      accumulationOverrides: [],
      decumulationOverrides: [],
    });
    const r = res as Record<string, unknown>;
    const result = r.result as Record<string, unknown> | undefined;
    projection = {
      portfolioDepletionAge: result?.portfolioDepletionAge ?? null,
      sustainableWithdrawal: result?.sustainableWithdrawal ?? null,
      projectionByYear: result?.projectionByYear ?? null,
      settings: r.settings ?? null,
      perPersonSettings: r.perPersonSettings ?? null,
    };
  } catch (e) {
    projection = { error: String(e) };
  }

  console.log("Capturing savings_planned_transactions WHERE source='rule'...");
  const plannedRuleTxns = await db
    .select()
    .from(schema.savingsPlannedTransactions)
    .where(eq(schema.savingsPlannedTransactions.source, "rule"));

  console.log(
    "Capturing contribution-profiles.compareData (per-account totals)...",
  );
  const contribCompareData = await caller.contributionProfile.compareData();

  const fixture = {
    capturedAt: new Date().toISOString(),
    paycheckSummary,
    retirementByPerson,
    projection,
    plannedRuleTxns,
    contribCompareData,
  };

  // Canonical key order. The engine builds some objects by different code
  // paths depending on branch, so raw JSON.stringify emits the same VALUES
  // with keys in a different order — which a byte-diff reports as a change.
  // Sorting makes the artifact a stable value comparison (found 2026-08-30:
  // a restore-to-identical-data run diffed on ordering alone).
  fs.writeFileSync(outPath, JSON.stringify(sortDeep(fixture), replacer, 2));
  console.log(`Golden baseline written to ${outPath}`);
  process.exit(0);
}

/** Recursively sort object keys so the emitted fixture is canonical. */
function sortDeep(value: unknown): unknown {
  if (value instanceof Map) return sortDeep(Object.fromEntries(value));
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, sortDeep(src[k])]),
    );
  }
  return value;
}

// Map/Date-safe JSON replacer
function replacer(_key: string, value: unknown) {
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
