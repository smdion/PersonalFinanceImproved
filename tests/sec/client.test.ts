/** SEC client: every known-good file passes its check; a broken one fails
 *  as bad-response naming the field. fetch is mocked; SEC is never asked. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchExpenseRatios,
  fetchFundTickers,
  fetchNport,
  fetchRegistry,
  listFilings,
} from "@/lib/sec/client";
import { BudgetApiError } from "@/lib/budget-api/errors";
import {
  EDGAR_ATOM_EMPTY,
  FUND_TICKERS,
  REGISTRY_HEADER_ONLY,
  REGISTRY_RENAMED_SERIES_NAME,
  edgarAtom,
  filingIndex,
  ncsrInstance,
  nportXml,
  registryCsv,
} from "../fixtures/sec";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const respond = (body: unknown, status = 200) =>
  mockFetch.mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    }),
  );

const FILING = {
  accession: "0001000001-26-000003",
  filingHref:
    "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000003/0001000001-26-000003-index.htm",
  filingDate: "2026-08-28",
};
const NOW = new Date("2026-11-02T12:00:00Z");

async function badResponse(p: Promise<unknown>): Promise<string> {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BudgetApiError);
  expect((err as BudgetApiError).code).toBe("bad-response");
  return (err as BudgetApiError).message;
}

beforeEach(() => mockFetch.mockReset());

describe("fund ticker list", () => {
  it("reads every listed class by symbol", async () => {
    respond(FUND_TICKERS);
    const map = await fetchFundTickers("me@example.com");
    expect(map.get("EXTGX")).toEqual({
      seriesId: "S000000002",
      classId: "C000000003",
    });
    expect(map.size).toBe(3);
  });

  it("skips a class with no symbol", async () => {
    respond({
      ...FUND_TICKERS,
      data: [...FUND_TICKERS.data, [1000003, "S000000009", "C000000009", null]],
    });
    expect((await fetchFundTickers("me@example.com")).size).toBe(3);
  });

  it("fails naming a renamed field, once for every row", async () => {
    respond({
      ...FUND_TICKERS,
      fields: ["cik", "series_id", "classId", "symbol"],
    });
    expect(await badResponse(fetchFundTickers("me@example.com"))).toBe(
      "SEC: /files/company_tickers_mf.json: 0.seriesId: expected string, received undefined (+2 more)",
    );
  });

  it("fails on a non-JSON answer", async () => {
    respond("<html>Request Rate Threshold Exceeded</html>");
    expect(await badResponse(fetchFundTickers("me@example.com"))).toMatch(
      /not JSON/,
    );
  });
});

describe("series/class registry", () => {
  it("reads every class, skipping a series with none yet", async () => {
    respond(registryCsv());
    const rows = await fetchRegistry("me@example.com", NOW);
    expect(rows).toEqual([
      expect.objectContaining({
        seriesId: "S000000001",
        classId: "C000000001",
        ticker: "EXBDX",
      }),
      expect.objectContaining({ classId: "C000000002", ticker: null }),
    ]);
  });

  it("uses last year's file while this year's isn't published", async () => {
    respond("Not Found", 404);
    respond(registryCsv());
    expect(await fetchRegistry("me@example.com", NOW)).toHaveLength(2);
    expect(mockFetch.mock.calls[1]![0]).toMatch(/class-2025\.csv$/);
  });

  it("fails naming a renamed column, without falling back to last year", async () => {
    respond(registryCsv(REGISTRY_RENAMED_SERIES_NAME));
    expect(await badResponse(fetchRegistry("me@example.com", NOW))).toMatch(
      /^SEC: \/files\/.*class-2026\.csv: 0\.seriesName: expected string, received undefined \(\+1 more\)$/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fails when it lists no fund", async () => {
    respond(REGISTRY_HEADER_ONLY);
    expect(await badResponse(fetchRegistry("me@example.com", NOW))).toMatch(
      /\(body\): Too small/,
    );
  });
});

describe("filing list", () => {
  it("lists filings newest first as served", async () => {
    respond(edgarAtom());
    const filings = await listFilings(
      "me@example.com",
      "S000000001",
      "NPORT-P",
    );
    expect(filings).toHaveLength(2);
    expect(filings[0]).toMatchObject({
      accession: "0001000001-26-000002",
      filingDate: "2026-08-28",
    });
  });

  it("is empty for a fund with no filings of the type", async () => {
    respond(EDGAR_ATOM_EMPTY);
    expect(await listFilings("me@example.com", "S000000001", "N-MFP")).toEqual(
      [],
    );
  });

  it.each([
    [{ accession: "accession-number", date: "filed-date" }, "filingDate"],
    [{ accession: "accession-no", date: "filing-date" }, "accession"],
  ])("fails naming a renamed field (%o)", async (tags, field) => {
    respond(edgarAtom(tags));
    expect(
      await badResponse(listFilings("me@example.com", "S1", "NPORT-P")),
    ).toBe(
      `SEC: /cgi-bin/browse-edgar: 0.${field}: expected string, received undefined (+1 more)`,
    );
  });
});

describe("N-PORT", () => {
  it("reads the period and every holding", async () => {
    respond(nportXml());
    const nport = await fetchNport("me@example.com", FILING);
    expect(nport.periodDate).toBe("2026-06-30");
    expect(nport.seriesLei).toBe("LEI0000000000000BOND");
    expect(nport.holdings.map((h) => h.pctVal)).toEqual([60.5, 39.5]);
    expect(mockFetch.mock.calls[0]![0]).toBe(
      "https://www.sec.gov/Archives/edgar/data/1000001/000100000126000003/primary_doc.xml",
    );
  });

  it("reads a filing with no holdings (in liquidation, or all cash)", async () => {
    respond(nportXml({ noHoldings: true }));
    expect((await fetchNport("me@example.com", FILING)).holdings).toEqual([]);
  });

  it.each([
    [{ pctVal: "N/A" }, "holdings.1.pctVal: expected number, received NaN"],
    [{ pctVal: "" }, "holdings.1.pctVal: expected number, received NaN"],
    [{ periodTag: "reportDate" }, "periodDate: expected string, received null"],
  ])("fails a broken filing (%o)", async (o, issue) => {
    respond(nportXml(o));
    expect(await badResponse(fetchNport("me@example.com", FILING))).toMatch(
      `SEC: /Archives/edgar/data/:cik/:accession/primary_doc.xml: ${issue}`,
    );
  });
});

describe("shareholder-report expense ratios", () => {
  it("reads every class's ratio from the filing's XBRL instance", async () => {
    respond(filingIndex());
    respond(ncsrInstance());
    expect(await fetchExpenseRatios("me@example.com", FILING)).toEqual(
      new Map([
        ["C000000001", 0.0005],
        ["C000000002", 0.0002],
      ]),
    );
    expect(mockFetch.mock.calls[1]![0]).toMatch(/example_ncsr_htm\.xml$/);
  });

  it("fails naming a renamed index field", async () => {
    respond(filingIndex("items"));
    expect(
      await badResponse(fetchExpenseRatios("me@example.com", FILING)),
    ).toBe(
      "SEC: /Archives/edgar/data/:cik/:accession/index.json: directory.item: expected array, received undefined",
    );
  });

  it("skips a class whose ratio is empty (nil)", async () => {
    respond(filingIndex());
    respond(ncsrInstance(""));
    expect(await fetchExpenseRatios("me@example.com", FILING)).toEqual(
      new Map([["C000000002", 0.0002]]),
    );
  });

  it("fails on a ratio that isn't a number", async () => {
    respond(filingIndex());
    respond(ncsrInstance("0.05%"));
    expect(
      await badResponse(fetchExpenseRatios("me@example.com", FILING)),
    ).toMatch(/:instance\.xml: C000000001: expected number, received NaN/);
  });
});
