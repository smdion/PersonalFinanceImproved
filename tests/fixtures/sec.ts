/**
 * SEC files in the shapes EDGAR serves them (its published file layouts:
 * company_tickers_mf.json, the series/class registry CSV, the browse-edgar
 * Atom feed, N-PORT XML, a filing's index.json, an N-CSR XBRL instance).
 * Funds, ids and numbers are invented.
 */

export const FUND_TICKERS = {
  fields: ["cik", "seriesId", "classId", "symbol"],
  data: [
    [1000001, "S000000001", "C000000001", "EXBDX"],
    [1000001, "S000000001", "C000000002", "EXBIX"],
    [1000002, "S000000002", "C000000003", "EXTGX"],
  ],
};

const REGISTRY_HEADER =
  "Reporting File Number,CIK Number,Entity Name,Entity Org Type,Series ID,Series Name,Class ID,Class Name,Class Ticker,Address_1,Address_2,City,State,Zip Code";

export function registryCsv(header = REGISTRY_HEADER): string {
  return (
    `﻿${header}\r\n` +
    '811-1,0001000001,"Example Funds, Inc",30,S000000001,Example Total Bond Fund,C000000001,Investor,exbdx,1 Main St,,Springfield,IL,62701\r\n' +
    "811-1,0001000001,Example Funds,30,S000000001,Example Total Bond Fund,C000000002,Institutional,,1 Main St,,Springfield,IL,62701\r\n" +
    // A series registered before it has share classes.
    "811-2,0001000002,Example Trust,30,S000000003,Example New Fund,,,,1 Main St,,Springfield,IL,62701\r\n"
  );
}
export const REGISTRY_HEADER_ONLY = `${REGISTRY_HEADER}\r\n`;
export const REGISTRY_RENAMED_SERIES_NAME = REGISTRY_HEADER.replace(
  "Series Name",
  "Series_Name",
);

const entry = (accession: string, date: string, tags = DEFAULT_TAGS) =>
  `<entry><category label="form type" scheme="https://www.sec.gov/" term="NPORT-P"/>
    <content type="text/xml">
      <${tags.accession}>${accession}</${tags.accession}>
      <file-number>811-1</file-number>
      <${tags.date}>${date}</${tags.date}>
      <filing-href>https://www.sec.gov/Archives/edgar/data/1000001/${accession.replace(/-/g, "")}/${accession}-index.htm</filing-href>
      <filing-type>NPORT-P</filing-type>
      <form-name>Monthly Portfolio Investments Report</form-name>
      <size>2 MB</size>
    </content>
    <id>urn:tag:sec.gov,2008:accession-number=${accession}</id>
    <title>NPORT-P  - Monthly Portfolio Investments Report</title>
    <updated>${date}T16:01:12-04:00</updated>
  </entry>`;
const DEFAULT_TAGS = { accession: "accession-number", date: "filing-date" };

export function edgarAtom(tags = DEFAULT_TAGS): string {
  return `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <company-info><cik>0001000001</cik><conformed-name>EXAMPLE FUNDS</conformed-name></company-info>
  <title>EXAMPLE FUNDS  (0001000001)</title>
  ${entry("0001000001-26-000002", "2026-08-28", tags)}
  ${entry("0001000001-26-000001", "2026-05-29", tags)}
</feed>`;
}
export const EDGAR_ATOM_EMPTY = `<?xml version="1.0" encoding="ISO-8859-1" ?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>EXAMPLE FUNDS</title></feed>`;

const holding = (name: string, pctVal: string) =>
  `<invstOrSec>
        <name>${name}</name>
        <lei>N/A</lei>
        <title>${name}</title>
        <cusip>000000000</cusip>
        <balance>1000</balance>
        <units>NS</units>
        <curCd>USD</curCd>
        <valUSD>100000.00</valUSD>
        <pctVal>${pctVal}</pctVal>
        <payoffProfile>Long</payoffProfile>
        <assetCat>EC</assetCat>
        <issuerCat>CORP</issuerCat>
        <invCountry>US</invCountry>
      </invstOrSec>`;

export function nportXml(
  o: { pctVal?: string; periodTag?: string; noHoldings?: boolean } = {},
): string {
  const periodTag = o.periodTag ?? "repPdDate";
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport" xmlns:com="http://www.sec.gov/edgar/common">
  <headerData><submissionType>NPORT-P</submissionType></headerData>
  <formData>
    <genInfo>
      <regName>Example Funds</regName>
      <regCik>0001000001</regCik>
      <seriesName>EXAMPLE TOTAL BOND FUND</seriesName>
      <seriesId>S000000001</seriesId>
      <seriesLei>LEI0000000000000BOND</seriesLei>
      <repPdEnd>2026-09-30</repPdEnd>
      <${periodTag}>2026-06-30</${periodTag}>
      <isFinalFiling>N</isFinalFiling>
    </genInfo>
    <invstOrSecs>
      ${o.noHoldings ? "" : holding("Example Stock Corp", "60.5")}
      ${o.noHoldings ? "" : holding("Example Other Corp", o.pctVal ?? "39.5")}
    </invstOrSecs>
  </formData>
</edgarSubmission>`;
}

export function filingIndex(itemKey = "item") {
  return {
    directory: {
      [itemKey]: [
        {
          "last-modified": "2026-08-28 16:01:12",
          name: "0001000001-26-000003-index.htm",
          type: "text.gif",
          size: "",
        },
        {
          "last-modified": "2026-08-28 16:01:12",
          name: "example_ncsr.htm",
          type: "text.gif",
          size: "512000",
        },
        {
          "last-modified": "2026-08-28 16:01:12",
          name: "example_ncsr_htm.xml",
          type: "text.gif",
          size: "64000",
        },
      ],
      name: "/Archives/edgar/data/1000001/000100000126000003",
      "parent-dir": "/Archives/edgar/data/1000001",
    },
  };
}

export function ncsrInstance(ratio = "0.0005"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:oef="http://xbrl.sec.gov/oef/2025">
  <oef:ExpenseRatioPct contextRef="FY2026_C000000001Member" unitRef="pure" decimals="4">${ratio}</oef:ExpenseRatioPct>
  <oef:ExpenseRatioPct contextRef="FY2026_C000000002Member" unitRef="pure" decimals="4">0.0002</oef:ExpenseRatioPct>
</xbrli:xbrl>`;
}
