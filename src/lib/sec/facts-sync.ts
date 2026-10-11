/**
 * Weekly SEC fund-facts refresh: for every fund the household holds,
 * resolve its SEC identity, then store its latest expense ratio (shareholder
 * report) and composition (N-PORT, looking through funds it holds).
 * Generic over any registered fund — nothing here names a fund or ticker.
 *
 * Funds SEC doesn't list get a suggested stand-in (stored unconfirmed);
 * facts are fetched for a stand-in only once the household confirms it.
 * A 403/429 from SEC stops the run; the last stored facts stay.
 */
import "server-only";
import { eq, inArray, isNull, lt, or } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import {
  EMPTY_BUCKETS,
  composeFund,
  normalizeSeriesName,
  type Composition,
  type HoldingResolution,
} from "@/lib/pure/sec-composition";
import {
  buildRegistryIndex,
  suggestStandIn,
  type RegistryIndex,
} from "@/lib/pure/sec-identity";
import { getSecContact } from "./connection";
import {
  SecRateLimitError,
  fetchExpenseRatio,
  fetchFundTickers,
  fetchNport,
  fetchRegistry,
  listFilings,
} from "./client";
import type { EdgarFiling } from "./parsers";

type Db = typeof import("@/lib/db").db;

const CHECK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOOK_THROUGH_DEPTH = 2;
const LAST_RUN_KEY = "sec_facts_last_run";
const LAST_ERROR_KEY = "sec_facts_last_error";

export type SecFactsSummary = {
  checked: number;
  updated: number;
  unresolved: number;
  stoppedBySec: boolean;
  errors: string[];
};

function toRow(c: Composition) {
  const f = (n: number) => n.toFixed(6);
  return {
    usEquityPct: f(c.us_equity),
    intlEquityPct: f(c.intl_equity),
    usBondPct: f(c.us_bond),
    intlBondPct: f(c.intl_bond),
    tipsPct: f(c.tips),
    cashPct: f(c.cash),
    otherPct: f(c.other),
    coverage: f(c.coverage),
  };
}

function fromRow(r: typeof schema.secFilingCache.$inferSelect): Composition {
  const n = (v: string | null) => Number(v ?? 0);
  return {
    us_equity: n(r.usEquityPct),
    intl_equity: n(r.intlEquityPct),
    us_bond: n(r.usBondPct),
    intl_bond: n(r.intlBondPct),
    tips: n(r.tipsPct),
    cash: n(r.cashPct),
    other: n(r.otherPct),
    coverage: n(r.coverage),
  };
}

/** Newest filing; an amendment for the same period counts as newer. */
function latest(filings: EdgarFiling[]): EdgarFiling | undefined {
  return [...filings].sort((a, b) =>
    b.filingDate.localeCompare(a.filingDate),
  )[0];
}

class Composer {
  constructor(
    private db: Db,
    private contact: string,
    private index: RegistryIndex,
  ) {}

  /** Composition of a series' filing, from the cache or SEC, looking through funds it holds. */
  async compose(
    seriesId: string,
    filing: EdgarFiling,
    depth: number,
  ): Promise<{
    composition: Composition;
    periodDate: string;
    lei: string | null;
  }> {
    const [cached] = await this.db
      .select()
      .from(schema.secFilingCache)
      .where(eq(schema.secFilingCache.accession, filing.accession));
    if (cached)
      return {
        composition: fromRow(cached),
        periodDate: cached.periodEnd,
        lei: null,
      };

    const nport = await fetchNport(this.contact, filing);
    const resolutions: HoldingResolution[] = [];
    for (const h of nport.holdings) {
      const underlying =
        depth < MAX_LOOK_THROUGH_DEPTH && h.pctVal > 0
          ? this.index.seriesByName.get(normalizeSeriesName(h.name))
          : undefined;
      if (!underlying || underlying === seriesId) {
        resolutions.push({ kind: "security" });
        continue;
      }
      resolutions.push(await this.lookThrough(underlying, h.lei, depth + 1));
    }
    const composition = composeFund(nport.holdings, (i) => resolutions[i]!);
    const periodDate = nport.periodDate ?? filing.filingDate;
    await this.db
      .insert(schema.secFilingCache)
      .values({
        accession: filing.accession,
        seriesId,
        periodEnd: periodDate,
        ...toRow(composition),
      })
      .onConflictDoNothing();
    return { composition, periodDate, lei: nport.seriesLei };
  }

  /** A holding named like a registered fund: confirmed by LEI, else unresolved. */
  private async lookThrough(
    seriesId: string,
    holdingLei: string | null,
    depth: number,
  ): Promise<HoldingResolution> {
    if (!holdingLei) return { kind: "unresolved_fund" };
    try {
      const filing = latest(
        await listFilings(this.contact, seriesId, "NPORT-P"),
      );
      if (!filing) return { kind: "unresolved_fund" };
      const { composition, lei } = await this.compose(seriesId, filing, depth);
      // A cached composition carries no LEI; its first fetch was confirmed.
      if (lei !== null && lei !== holdingLei)
        return { kind: "unresolved_fund" };
      return { kind: "fund", composition };
    } catch (err) {
      if (err instanceof SecRateLimitError) throw err;
      return { kind: "unresolved_fund" };
    }
  }
}

async function setSetting(db: Db, key: string, value: string | null) {
  if (value === null) {
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key));
    return;
  }
  await db
    .insert(schema.appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } });
}

export async function getSecFactsStatus(db: Db): Promise<{
  lastRun: string | null;
  lastError: string | null;
}> {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .where(inArray(schema.appSettings.key, [LAST_RUN_KEY, LAST_ERROR_KEY]));
  const get = (k: string) => {
    const v = rows.find((r) => r.key === k)?.value;
    return typeof v === "string" ? v : null;
  };
  return { lastRun: get(LAST_RUN_KEY), lastError: get(LAST_ERROR_KEY) };
}

/** Whether the weekly refresh is due (persisted, so it survives restarts). */
export async function secFactsRefreshDue(db: Db, now = new Date()) {
  const { lastRun } = await getSecFactsStatus(db);
  return !lastRun || now.getTime() - Date.parse(lastRun) >= CHECK_EVERY_MS;
}

export async function syncSecurityFacts(
  db: Db,
  options: { force?: boolean; now?: Date; securityIds?: number[] } = {},
): Promise<SecFactsSummary> {
  const now = options.now ?? new Date();
  const summary: SecFactsSummary = {
    checked: 0,
    updated: 0,
    unresolved: 0,
    stoppedBySec: false,
    errors: [],
  };
  const contact = await getSecContact(db);
  if (!contact) return summary;

  const s = schema.securities;
  const due = await db
    .select()
    .from(s)
    .where(
      options.securityIds
        ? inArray(s.id, options.securityIds)
        : options.force
          ? undefined
          : or(
              isNull(s.factsCheckedAt),
              lt(s.factsCheckedAt, new Date(now.getTime() - CHECK_EVERY_MS)),
            ),
    );
  try {
    if (due.length > 0) {
      const index = buildRegistryIndex(
        await fetchRegistry(contact, now),
        await fetchFundTickers(contact),
      );
      const composer = new Composer(db, contact, index);
      for (const sec of due) {
        summary.checked++;
        try {
          const updated = await refreshOne(
            db,
            contact,
            index,
            composer,
            sec,
            now,
          );
          if (updated === null) summary.unresolved++;
          else summary.updated += updated;
        } catch (err) {
          if (err instanceof SecRateLimitError) throw err;
          summary.errors.push(
            `${sec.ticker ?? sec.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    if (!options.securityIds)
      await setSetting(db, LAST_RUN_KEY, now.toISOString());
    await setSetting(
      db,
      LAST_ERROR_KEY,
      summary.errors.length ? summary.errors.slice(0, 5).join("; ") : null,
    );
  } catch (err) {
    if (!(err instanceof SecRateLimitError)) throw err;
    summary.stoppedBySec = true;
    await setSetting(
      db,
      LAST_ERROR_KEY,
      `${err.message}. Stopped this run; the last stored facts are kept.`,
    );
  }
  log("info", "sec_facts_sync", { ...summary, errors: summary.errors.length });
  return summary;
}

/** Refresh one fund. Returns rows written, or null when it has no SEC source yet. */
async function refreshOne(
  db: Db,
  contact: string,
  index: RegistryIndex,
  composer: Composer,
  sec: typeof schema.securities.$inferSelect,
  now: Date,
): Promise<number | null> {
  const s = schema.securities;
  // 1. Identity: its own registration, or a suggested stand-in (unconfirmed).
  if (!sec.secSeriesId && !sec.factsSeriesId && sec.factsBasis !== "none") {
    const symbol = (sec.ticker ?? sec.sourceSymbol ?? "").toUpperCase();
    const own = symbol ? index.byTicker.get(symbol) : undefined;
    if (own) {
      Object.assign(sec, {
        secSeriesId: own.seriesId,
        secClassId: own.classId,
        factsSeriesId: own.seriesId,
        factsClassId: own.classId,
        factsSeriesName: index.series.get(own.seriesId)?.name ?? null,
        factsBasis: "exact" as const,
      });
    } else {
      const suggestion = suggestStandIn(
        sec.sourceDescription ?? sec.name,
        index,
      );
      if (suggestion)
        Object.assign(sec, {
          factsSeriesId: suggestion.seriesId,
          factsSeriesName: suggestion.name,
          factsClassId:
            index.series.get(suggestion.seriesId)?.classIds[0] ?? null,
          factsBasis: "standin" as const,
          standinConfirmedAt: null,
        });
    }
    await db
      .update(s)
      .set({
        secSeriesId: sec.secSeriesId,
        secClassId: sec.secClassId,
        factsSeriesId: sec.factsSeriesId,
        factsClassId: sec.factsClassId,
        factsSeriesName: sec.factsSeriesName,
        factsBasis: sec.factsBasis,
      })
      .where(eq(s.id, sec.id));
  }

  // SEC confirmed the symbol (its own registration), so it's a validated
  // ticker — record it unless another fund already holds it.
  const symbol = (sec.ticker ?? sec.sourceSymbol ?? "").toUpperCase();
  if (!sec.ticker && sec.secSeriesId && symbol) {
    const [taken] = await db
      .select({ id: s.id })
      .from(s)
      .where(eq(s.ticker, symbol));
    if (!taken)
      await db.update(s).set({ ticker: symbol }).where(eq(s.id, sec.id));
  }

  const usable =
    sec.factsSeriesId &&
    (sec.factsBasis === "exact" || sec.standinConfirmedAt !== null);
  let written = 0;
  if (usable) {
    const f = schema.securityFacts;
    const known = new Set(
      (
        await db
          .select({ accession: f.accession })
          .from(f)
          .where(eq(f.securityId, sec.id))
      ).map((r) => r.accession),
    );
    // 2. Composition from the latest N-PORT.
    const nport = latest(
      await listFilings(contact, sec.factsSeriesId!, "NPORT-P"),
    );
    if (!nport) {
      // Money market funds report on N-MFP instead of N-PORT; by rule they
      // hold cash-like instruments only.
      const nmfp = latest(
        await listFilings(contact, sec.factsSeriesId!, "N-MFP"),
      );
      if (nmfp && !known.has(nmfp.accession)) {
        await upsertFact(db, {
          securityId: sec.id,
          source: "sec_nmfp",
          asOf: nmfp.filingDate,
          secSeriesId: sec.factsSeriesId!,
          accession: nmfp.accession,
          ...toRow({ ...EMPTY_BUCKETS, cash: 1, coverage: 1 }),
        });
        written++;
      }
    } else if (!known.has(nport.accession)) {
      const { composition, periodDate } = await composer.compose(
        sec.factsSeriesId!,
        nport,
        0,
      );
      await upsertFact(db, {
        securityId: sec.id,
        source: "sec_nport",
        asOf: periodDate,
        secSeriesId: sec.factsSeriesId!,
        accession: nport.accession,
        ...toRow(composition),
      });
      written++;
    }
    // 3. Expense ratio from the latest shareholder report.
    if (sec.factsClassId) {
      const report = latest(
        await listFilings(contact, sec.factsClassId, "N-CSR"),
      );
      if (report && !known.has(report.accession)) {
        const er = await fetchExpenseRatio(contact, report, sec.factsClassId);
        if (er !== null) {
          await upsertFact(db, {
            securityId: sec.id,
            source: "sec_ncsr",
            asOf: report.filingDate,
            secSeriesId: sec.factsSeriesId!,
            accession: report.accession,
            expenseRatio: er.toFixed(6),
          });
          written++;
        }
      }
    }
  }
  await db.update(s).set({ factsCheckedAt: now }).where(eq(s.id, sec.id));
  return usable ? written : null;
}

async function upsertFact(
  db: Db,
  values: typeof schema.securityFacts.$inferInsert,
): Promise<void> {
  const f = schema.securityFacts;
  // An amended filing for the same period replaces the original.
  await db
    .insert(f)
    .values(values)
    .onConflictDoUpdate({
      target: [f.securityId, f.source, f.asOf],
      set: { ...values, fetchedAt: new Date() },
    });
}
