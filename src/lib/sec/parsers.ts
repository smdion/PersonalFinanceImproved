/**
 * Streaming parsers for SEC data: N-PORT holdings, shareholder-report
 * (N-CSR) expense ratios, EDGAR filing lists and the fund series/class
 * registry. Each takes text in chunks so large filings (a bond fund's
 * N-PORT can be ~20 MB) are never held as a document tree.
 */
import { SaxesParser } from "saxes";
import type { NportHolding } from "@/lib/pure/sec-composition";

type Chunked<T> = { write(chunk: string): void; close(): T };

/** Local element name without namespace prefix. */
const local = (name: string) => name.slice(name.indexOf(":") + 1);

export type NportFiling = {
  seriesId: string | null;
  seriesName: string | null;
  seriesLei: string | null;
  /** Date the holdings are as of (repPdDate). */
  periodDate: string | null;
  holdings: NportHolding[];
};

export function createNportParser(): Chunked<NportFiling> {
  const p = new SaxesParser();
  const result: NportFiling = {
    seriesId: null,
    seriesName: null,
    seriesLei: null,
    periodDate: null,
    holdings: [],
  };
  const path: string[] = [];
  let text = "";
  let current: NportHolding | null = null;
  p.on("opentag", (node) => {
    const name = local(node.name);
    path.push(name);
    text = "";
    if (name === "invstOrSec") {
      current = {
        name: "",
        lei: null,
        pctVal: 0,
        assetCat: null,
        invCountry: null,
        payoffProfile: null,
      };
    } else if (current && name === "assetConditional") {
      const cat = node.attributes["assetCat"];
      if (typeof cat === "string") current.assetCat = cat;
    }
  });
  p.on("text", (t) => {
    text += t;
  });
  p.on("closetag", (node) => {
    const name = local(node.name);
    const value = text.trim();
    const parent = path[path.length - 2];
    if (current) {
      if (name === "invstOrSec") {
        result.holdings.push(current);
        current = null;
      } else if (parent === "invstOrSec") {
        if (name === "name") current.name = value;
        else if (name === "lei")
          current.lei = value && value !== "N/A" ? value : null;
        else if (name === "pctVal") current.pctVal = Number(value) || 0;
        else if (name === "assetCat") current.assetCat = value || null;
        else if (name === "invCountry") current.invCountry = value || null;
        else if (name === "payoffProfile")
          current.payoffProfile = value || null;
      }
    } else if (name === "seriesId") result.seriesId = value || null;
    else if (name === "seriesName") result.seriesName = value || null;
    else if (name === "seriesLei") result.seriesLei = value || null;
    else if (name === "repPdDate") result.periodDate = value || null;
    path.pop();
    text = "";
  });
  return {
    write: (chunk) => void p.write(chunk),
    close: () => {
      p.close();
      return result;
    },
  };
}

/**
 * Annual expense ratio for one share class from a shareholder report's
 * XBRL instance (`oef:ExpenseRatioPct`, context naming the class id).
 */
export function createNcsrExpenseParser(
  classId: string,
): Chunked<number | null> {
  const p = new SaxesParser();
  let capturing = false;
  let text = "";
  let found: number | null = null;
  p.on("opentag", (node) => {
    if (local(node.name) !== "ExpenseRatioPct") return;
    const ctx = node.attributes["contextRef"];
    capturing = typeof ctx === "string" && ctx.includes(classId);
    text = "";
  });
  p.on("text", (t) => {
    if (capturing) text += t;
  });
  p.on("closetag", (node) => {
    if (capturing && local(node.name) === "ExpenseRatioPct") {
      const v = Number(text.trim());
      if (Number.isFinite(v) && found === null) found = v;
      capturing = false;
    }
  });
  return {
    write: (chunk) => void p.write(chunk),
    close: () => {
      p.close();
      return found;
    },
  };
}

export type EdgarFiling = {
  accession: string;
  filingHref: string;
  filingDate: string;
  filingType: string;
};

/** Entries of an EDGAR "browse" Atom feed, newest first as served. */
export function parseEdgarAtom(xml: string): EdgarFiling[] {
  const p = new SaxesParser();
  const out: EdgarFiling[] = [];
  let entry: Partial<EdgarFiling> | null = null;
  let text = "";
  p.on("opentag", (node) => {
    if (local(node.name) === "entry") entry = {};
    text = "";
  });
  p.on("text", (t) => {
    text += t;
  });
  p.on("closetag", (node) => {
    const name = local(node.name);
    const v = text.trim();
    if (entry) {
      if (name === "accession-number") entry.accession = v;
      else if (name === "filing-href") entry.filingHref = v;
      else if (name === "filing-date") entry.filingDate = v;
      else if (name === "filing-type") entry.filingType = v;
      else if (name === "entry") {
        if (entry.accession && entry.filingHref)
          out.push({
            accession: entry.accession,
            filingHref: entry.filingHref,
            filingDate: entry.filingDate ?? "",
            filingType: entry.filingType ?? "",
          });
        entry = null;
      }
    }
    text = "";
  });
  p.write(xml).close();
  return out;
}

/** One CSV record → fields (RFC 4180 quoting). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export type RegistryClass = {
  cik: string;
  seriesId: string;
  seriesName: string;
  classId: string;
  ticker: string | null;
};

/** SEC "Investment Company Series and Class" CSV, line by line. */
export function createRegistryParser(): Chunked<RegistryClass[]> {
  const rows: RegistryClass[] = [];
  let header: string[] | null = null;
  let buffer = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    const fields = splitCsvLine(line.replace(/^﻿/, ""));
    if (!header) {
      header = fields.map((f) => f.trim());
      return;
    }
    const get = (name: string) => fields[header!.indexOf(name)]?.trim() ?? "";
    const seriesId = get("Series ID");
    const classId = get("Class ID");
    if (!seriesId || !classId) return;
    rows.push({
      cik: get("CIK Number"),
      seriesId,
      seriesName: get("Series Name"),
      classId,
      ticker: get("Class Ticker").toUpperCase() || null,
    });
  };
  return {
    write: (chunk) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, nl).replace(/\r$/, ""));
        buffer = buffer.slice(nl + 1);
      }
    },
    close: () => {
      take(buffer);
      buffer = "";
      return rows;
    },
  };
}
