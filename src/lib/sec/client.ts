/**
 * SEC EDGAR client. Every request carries the household's contact in the
 * User-Agent (SEC's fair-access policy), is paced well under SEC's 10
 * requests/second, has a size cap and a timeout, and is streamed into a
 * parser. A 403/429 stops the whole run — no retries against SEC.
 * Every response is checked (schemas.ts) before use.
 *
 * The contact is never logged or included in errors.
 */
import "server-only";
import type { z } from "zod/v4";
import { BudgetApiError } from "@/lib/budget-api/errors";
import { parseExternal } from "@/lib/http/external-request";
import {
  createNportParser,
  createNcsrExpenseParser,
  createRegistryParser,
  parseEdgarAtom,
} from "./parsers";
import {
  expenseRatiosSchema,
  filingIndexSchema,
  filingsSchema,
  fundTickersSchema,
  nportSchema,
  registrySchema,
  type EdgarFiling,
  type RegistryClass,
} from "./schemas";

const MIN_GAP_MS = 150;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;

/** SEC refused or throttled us — stop the run. */
export class SecRateLimitError extends Error {
  override name = "SecRateLimitError";
}
class SecRequestError extends Error {
  override name = "SecRequestError";
}

let lastRequestAt = 0;
async function pace(): Promise<void> {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** Stream an SEC URL into `onChunk`. */
async function secStream(
  contact: string,
  url: string,
  onChunk: (text: string) => void,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<void> {
  await pace();
  const res = await fetch(url, {
    headers: {
      "User-Agent": `Ledgr self-hosted personal finance ${contact}`,
      "Accept-Encoding": "gzip, deflate",
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const path = new URL(url).pathname;
  if (res.status === 403 || res.status === 429)
    throw new SecRateLimitError(
      `SEC declined the request (${res.status}) for ${path}`,
    );
  if (!res.ok || !res.body)
    throw new SecRequestError(`SEC returned ${res.status} for ${path}`);
  const max = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const decoder = new TextDecoder();
  let bytes = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      throw new SecRequestError(`SEC response too large for ${path}`);
    }
    onChunk(decoder.decode(value, { stream: true }));
  }
  onChunk(decoder.decode());
}

async function secText(contact: string, url: string): Promise<string> {
  let text = "";
  await secStream(contact, url, (c) => (text += c), {
    maxBytes: 8 * 1024 * 1024,
  });
  return text;
}

/** A JSON file from SEC, checked against its schema. */
async function secJson<S extends z.ZodType>(
  contact: string,
  url: string,
  schema: S,
  endpoint: string,
): Promise<z.infer<S>> {
  const text = await secText(contact, url);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BudgetApiError(
      `SEC: ${endpoint}: not JSON`,
      "bad-response",
      null,
    );
  }
  return parseExternal(schema, body, { service: "sec", endpoint });
}

/** symbol → series/class, from SEC's mutual-fund ticker list. */
export async function fetchFundTickers(
  contact: string,
): Promise<Map<string, { seriesId: string; classId: string }>> {
  const rows = await secJson(
    contact,
    "https://www.sec.gov/files/company_tickers_mf.json",
    fundTickersSchema,
    "/files/company_tickers_mf.json",
  );
  const map = new Map<string, { seriesId: string; classId: string }>();
  for (const row of rows) {
    const symbol = row.symbol?.toUpperCase();
    if (symbol)
      map.set(symbol, { seriesId: row.seriesId, classId: row.classId });
  }
  return map;
}

/** SEC's fund series/class registry (this year's file, else last year's). */
export async function fetchRegistry(
  contact: string,
  now: Date = new Date(),
): Promise<RegistryClass[]> {
  const base =
    "https://www.sec.gov/files/investment/data/other/investment-company-series-class-information/investment-company-series-class-";
  let lastError: unknown = null;
  for (const year of [now.getFullYear(), now.getFullYear() - 1]) {
    const parser = createRegistryParser();
    try {
      const url = `${base}${year}.csv`;
      await secStream(contact, url, (c) => parser.write(c), {
        maxBytes: 40 * 1024 * 1024,
      });
      return parseExternal(registrySchema, parser.close(), {
        service: "sec",
        endpoint: new URL(url).pathname,
      });
    } catch (err) {
      // Last year's file stands in when this year's can't be fetched, not
      // when it fails its check.
      if (err instanceof SecRateLimitError) throw err;
      if (err instanceof BudgetApiError && err.code === "bad-response")
        throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** Latest filings of a type for a series ("S…") or share class ("C…"), newest first. */
export async function listFilings(
  contact: string,
  seriesOrClassId: string,
  type: "NPORT-P" | "N-CSR" | "N-MFP",
): Promise<EdgarFiling[]> {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(seriesOrClassId)}&type=${encodeURIComponent(type)}&dateb=&owner=include&count=10&output=atom`;
  return parseExternal(
    filingsSchema,
    parseEdgarAtom(await secText(contact, url)),
    {
      service: "sec",
      endpoint: "/cgi-bin/browse-edgar",
    },
  );
}

/** Folder URL of a filing, from its index link. */
function filingFolder(filing: EdgarFiling): string {
  return filing.filingHref.replace(/[^/]+$/, "");
}

export async function fetchNport(
  contact: string,
  filing: EdgarFiling,
): Promise<z.infer<typeof nportSchema>> {
  const parser = createNportParser();
  await secStream(contact, `${filingFolder(filing)}primary_doc.xml`, (c) =>
    parser.write(c),
  );
  return parseExternal(nportSchema, parser.close(), {
    service: "sec",
    endpoint: "/Archives/edgar/data/:cik/:accession/primary_doc.xml",
  });
}

/** Expense ratio of every share class in a shareholder report (class id → ratio). */
export async function fetchExpenseRatios(
  contact: string,
  filing: EdgarFiling,
): Promise<Map<string, number>> {
  const index = await secJson(
    contact,
    `${filingFolder(filing)}index.json`,
    filingIndexSchema,
    "/Archives/edgar/data/:cik/:accession/index.json",
  );
  // The inline-XBRL instance is the filing's "*_htm.xml" document.
  const instance = index.directory.item.find((i) => /_htm\.xml$/i.test(i.name));
  if (!instance) return new Map();
  const parser = createNcsrExpenseParser();
  await secStream(contact, `${filingFolder(filing)}${instance.name}`, (c) =>
    parser.write(c),
  );
  return parseExternal(expenseRatiosSchema, parser.close(), {
    service: "sec",
    endpoint: "/Archives/edgar/data/:cik/:accession/:instance.xml",
  });
}

/** Check SEC accepts this contact: one request for its fund ticker list. Returns how many funds it lists. */
export async function testSecContact(contact: string): Promise<number> {
  return (await fetchFundTickers(contact)).size;
}
