/**
 * SEC EDGAR client. Every request carries the household's contact in the
 * User-Agent (SEC's fair-access policy), is paced well under SEC's 10
 * requests/second, has a size cap and a timeout, and is streamed into a
 * parser. A 403/429 stops the whole run — no retries against SEC.
 *
 * The contact is never logged or included in errors.
 */
import "server-only";
import {
  createNportParser,
  createNcsrExpenseParser,
  createRegistryParser,
  parseEdgarAtom,
  type EdgarFiling,
  type NportFiling,
  type RegistryClass,
} from "./parsers";

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

/** symbol → series/class, from SEC's mutual-fund ticker list. */
export async function fetchFundTickers(
  contact: string,
): Promise<Map<string, { seriesId: string; classId: string }>> {
  const json = JSON.parse(
    await secText(contact, "https://www.sec.gov/files/company_tickers_mf.json"),
  ) as { fields: string[]; data: (string | number)[][] };
  const i = (f: string) => json.fields.indexOf(f);
  const map = new Map<string, { seriesId: string; classId: string }>();
  for (const row of json.data) {
    const symbol = String(row[i("symbol")] ?? "").toUpperCase();
    if (symbol)
      map.set(symbol, {
        seriesId: String(row[i("seriesId")]),
        classId: String(row[i("classId")]),
      });
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
      await secStream(contact, `${base}${year}.csv`, (c) => parser.write(c), {
        maxBytes: 40 * 1024 * 1024,
      });
      return parser.close();
    } catch (err) {
      if (err instanceof SecRateLimitError) throw err;
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
  return parseEdgarAtom(await secText(contact, url));
}

/** Folder URL of a filing, from its index link. */
function filingFolder(filing: EdgarFiling): string {
  return filing.filingHref.replace(/[^/]+$/, "");
}

export async function fetchNport(
  contact: string,
  filing: EdgarFiling,
): Promise<NportFiling> {
  const parser = createNportParser();
  await secStream(contact, `${filingFolder(filing)}primary_doc.xml`, (c) =>
    parser.write(c),
  );
  return parser.close();
}

/** Expense ratio of every share class in a shareholder report (class id → ratio). */
export async function fetchExpenseRatios(
  contact: string,
  filing: EdgarFiling,
): Promise<Map<string, number>> {
  const index = JSON.parse(
    await secText(contact, `${filingFolder(filing)}index.json`),
  ) as { directory: { item: { name: string }[] } };
  // The inline-XBRL instance is the filing's "*_htm.xml" document.
  const instance = index.directory.item.find((i) => /_htm\.xml$/i.test(i.name));
  if (!instance) return new Map();
  const parser = createNcsrExpenseParser();
  await secStream(contact, `${filingFolder(filing)}${instance.name}`, (c) =>
    parser.write(c),
  );
  return parser.close();
}

/** Check SEC accepts this contact: one request for its fund ticker list. Returns how many funds it lists. */
export async function testSecContact(contact: string): Promise<number> {
  return (await fetchFundTickers(contact)).size;
}
