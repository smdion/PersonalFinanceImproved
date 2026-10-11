/** Streaming SEC parsers on small invented documents. */
import { describe, it, expect } from "vitest";
import {
  createNcsrExpenseParser,
  createNportParser,
  createRegistryParser,
  parseEdgarAtom,
  splitCsvLine,
} from "@/lib/sec/parsers";

const NPORT = `<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport">
  <formData>
    <genInfo>
      <seriesName>EXAMPLE TARGET 2050 FUND</seriesName>
      <seriesId>S000000001</seriesId>
      <seriesLei>LEI0000000000000FUND</seriesLei>
      <repPdDate>2026-06-30</repPdDate>
    </genInfo>
    <invstOrSecs>
      <invstOrSec>
        <name>Example Total Bond Fund</name>
        <lei>LEI0000000000000BOND</lei>
        <pctVal>40.5</pctVal>
        <payoffProfile>Long</payoffProfile>
        <assetCat>EC</assetCat>
        <invCountry>US</invCountry>
      </invstOrSec>
      <invstOrSec>
        <name>N/A</name>
        <lei>N/A</lei>
        <pctVal>-0.2</pctVal>
        <payoffProfile>N/A</payoffProfile>
        <assetConditional desc="futures" assetCat="DE"/>
        <invCountry>N/A</invCountry>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

describe("createNportParser", () => {
  it("reads the series identity and every holding, in any chunking", () => {
    const p = createNportParser();
    for (let i = 0; i < NPORT.length; i += 7) p.write(NPORT.slice(i, i + 7));
    const f = p.close();
    expect(f).toMatchObject({
      seriesId: "S000000001",
      seriesName: "EXAMPLE TARGET 2050 FUND",
      seriesLei: "LEI0000000000000FUND",
      periodDate: "2026-06-30",
    });
    expect(f.holdings).toEqual([
      {
        name: "Example Total Bond Fund",
        lei: "LEI0000000000000BOND",
        pctVal: 40.5,
        assetCat: "EC",
        invCountry: "US",
        payoffProfile: "Long",
      },
      {
        name: "N/A",
        lei: null,
        pctVal: -0.2,
        assetCat: "DE",
        invCountry: "N/A",
        payoffProfile: "N/A",
      },
    ]);
  });
});

describe("createNcsrExpenseParser", () => {
  const XBRL = `<xbrli:xbrl xmlns:xbrli="x" xmlns:oef="y">
    <oef:ExpenseRatioPct contextRef="FY2025_C000000002Member" unitRef="pure">0.0005</oef:ExpenseRatioPct>
    <oef:ExpenseRatioPct contextRef="FY2025_C000000001Member" unitRef="pure">0.0012</oef:ExpenseRatioPct>
  </xbrli:xbrl>`;
  it("returns every share class's expense ratio", () => {
    const p = createNcsrExpenseParser();
    p.write(XBRL);
    expect(p.close()).toEqual(
      new Map([
        ["C000000002", 0.0005],
        ["C000000001", 0.0012],
      ]),
    );
  });
});

describe("parseEdgarAtom", () => {
  it("lists filings with accession, link, date and type", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><content>
      <accession-number>0000000000-26-000001</accession-number>
      <filing-date>2026-08-28</filing-date>
      <filing-href>https://www.sec.gov/Archives/edgar/data/1/000000000026000001/0000000000-26-000001-index.htm</filing-href>
      <filing-type>NPORT-P</filing-type></content></entry></feed>`;
    expect(parseEdgarAtom(atom)).toEqual([
      {
        accession: "0000000000-26-000001",
        filingDate: "2026-08-28",
        filingHref:
          "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/0000000000-26-000001-index.htm",
        filingType: "NPORT-P",
      },
    ]);
  });
});

describe("registry CSV", () => {
  it("splits quoted fields", () => {
    expect(splitCsvLine('a,"b, c","d ""e"""')).toEqual(["a", "b, c", 'd "e"']);
  });
  it("reads series and classes across chunk boundaries", () => {
    const csv =
      "﻿Reporting File Number,CIK Number,Entity Name,Entity Org Type,Series ID,Series Name,Class ID,Class Name,Class Ticker\r\n" +
      '811-1,0000000001,"Example Funds, Inc",30,S000000001,Example Total Bond Fund,C000000001,Investor,exbdx\r\n' +
      "811-1,0000000001,Example Funds,30,S000000001,Example Total Bond Fund,C000000002,Institutional,\r\n";
    const p = createRegistryParser();
    for (let i = 0; i < csv.length; i += 11) p.write(csv.slice(i, i + 11));
    expect(p.close()).toEqual([
      {
        cik: "0000000001",
        seriesId: "S000000001",
        seriesName: "Example Total Bond Fund",
        classId: "C000000001",
        ticker: "EXBDX",
      },
      {
        cik: "0000000001",
        seriesId: "S000000001",
        seriesName: "Example Total Bond Fund",
        classId: "C000000002",
        ticker: null,
      },
    ]);
  });
});
