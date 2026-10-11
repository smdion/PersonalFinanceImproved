/**
 * SEC fund-facts sync with SEC mocked. Invented funds, series and filings.
 */
import "../helpers/setup-mocks";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDbContext } from "../helpers/db-harness";

const sec = vi.hoisted(() => ({ rateLimited: false, nportCalls: 0 }));

vi.mock("@/lib/sec/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/sec/client")>(
      "@/lib/sec/client",
    );
  const filing = (accession: string, date = "2026-08-28") => ({
    accession,
    filingHref: `https://www.sec.gov/Archives/edgar/data/1/${accession}/${accession}-index.htm`,
    filingDate: date,
    filingType: "X",
  });
  const holding = (name: string, pctVal: number, extra = {}) => ({
    name,
    lei: null,
    pctVal,
    assetCat: "EC",
    invCountry: "US",
    payoffProfile: "Long",
    ...extra,
  });
  return {
    ...actual,
    fetchRegistry: vi.fn(async () => {
      if (sec.rateLimited)
        throw new actual.SecRateLimitError("SEC declined the request (429)");
      return [
        {
          cik: "1",
          seriesId: "S1",
          seriesName: "Example Target 2050 Fund",
          classId: "C1",
          ticker: "EXTGX",
        },
        {
          cik: "1",
          seriesId: "S2",
          seriesName: "Example Total Bond Fund",
          classId: "C2",
          ticker: null,
        },
        {
          cik: "1",
          seriesId: "S3",
          seriesName: "Example Money Market Fund",
          classId: "C3",
          ticker: "EXMMX",
        },
        {
          cik: "1",
          seriesId: "S4",
          seriesName: "Example LifeStage Index 2060 Fund",
          classId: "C4",
          ticker: null,
        },
      ];
    }),
    fetchFundTickers: vi.fn(async () => new Map()),
    listFilings: vi.fn(async (_c: string, id: string, type: string) => {
      if (type === "NPORT-P" && (id === "S1" || id === "S2" || id === "S4"))
        return [filing(`nport-${id}`)];
      if (type === "N-MFP" && id === "S3") return [filing("nmfp-S3")];
      if (type === "N-CSR") return [filing(`ncsr-${id}`)];
      return [];
    }),
    fetchNport: vi.fn(async (_c: string, f: { accession: string }) => {
      sec.nportCalls++;
      if (f.accession === "nport-S1")
        return {
          seriesId: "S1",
          seriesName: "EXAMPLE TARGET 2050 FUND",
          seriesLei: "LEI-TARGET",
          periodDate: "2026-06-30",
          holdings: [
            holding("Example Total Bond Fund", 40, { lei: "LEI-BOND" }),
            holding("Example Stock Corp", 60),
          ],
        };
      if (f.accession === "nport-S2")
        return {
          seriesId: "S2",
          seriesName: "EXAMPLE TOTAL BOND FUND",
          seriesLei: "LEI-BOND",
          periodDate: "2026-06-30",
          holdings: [holding("Example Treasury", 100, { assetCat: "DBT" })],
        };
      return {
        seriesId: "S4",
        seriesName: "EXAMPLE LIFESTAGE INDEX 2060 FUND",
        seriesLei: "LEI-LIFE",
        periodDate: "2026-06-30",
        holdings: [holding("Example Intl Corp", 100, { invCountry: "JP" })],
      };
    }),
    fetchExpenseRatios: vi.fn(
      async () =>
        new Map([
          ["C1", 0.0012],
          ["C3", 0.0011],
          ["C4", 0.0035], // the stand-in's retail class
          ["C5", 0.0009], // its cheaper class
        ]),
    ),
  };
});

const KEY = randomBytes(32).toString("base64");
let originalKey: string | undefined;
beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

import { saveSecConnection } from "@/lib/sec/connection";
import { getSecFactsStatus, syncSecurityFacts } from "@/lib/sec/facts-sync";

describe("syncSecurityFacts", () => {
  let ctx: TestDbContext;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    ctx = await createTestDb();
    await saveSecConnection(ctx.rawDb, "contact@example.com");
    const add = (
      key: string,
      values: Partial<typeof ctx.schema.securities.$inferInsert>,
    ) => {
      ids[key] = ctx.db
        .insert(ctx.schema.securities)
        .values({
          name: key,
          kind: "mutual_fund",
          institution: "Example Bank",
          sourceDescription: key,
          ...values,
        })
        .returning()
        .get().id;
    };
    add("target", { sourceSymbol: "EXTGX" });
    add("mm", { sourceSymbol: "EXMMX", kind: "money_market" });
    add("plan", {
      sourceSymbol: "ZZPQ",
      name: "LifeStage Index 2060 NL Fund H",
      sourceDescription: "LifeStage Index 2060 NL Fund H",
    });
  });
  afterAll(() => ctx.cleanup());
  beforeEach(() => {
    sec.rateLimited = false;
    sec.nportCalls = 0;
  });

  const facts = (key: string) =>
    ctx.db
      .select()
      .from(ctx.schema.securityFacts)
      .where(eq(ctx.schema.securityFacts.securityId, ids[key]!))
      .all();
  const security = (key: string) =>
    ctx.db
      .select()
      .from(ctx.schema.securities)
      .where(eq(ctx.schema.securities.id, ids[key]!))
      .get()!;

  it("stores composition (looked through, LEI-confirmed) and expense ratio for any listed fund", async () => {
    const r = await syncSecurityFacts(ctx.rawDb, {
      now: new Date("2026-10-01T00:00:00Z"),
    });
    expect(r.stoppedBySec).toBe(false);
    const nport = facts("target").find((f) => f.source === "sec_nport")!;
    expect(Number(nport.usBondPct)).toBeCloseTo(0.4);
    expect(Number(nport.usEquityPct)).toBeCloseTo(0.6);
    expect(Number(nport.coverage)).toBe(1);
    expect(
      Number(
        facts("target").find((f) => f.source === "sec_ncsr")!.expenseRatio,
      ),
    ).toBeCloseTo(0.0012);
    expect(security("target")).toMatchObject({
      ticker: "EXTGX",
      factsBasis: "exact",
      secSeriesId: "S1",
    });
  });

  it("treats a money market fund as cash from its N-MFP report", () => {
    const mm = facts("mm").find((f) => f.source === "sec_nmfp")!;
    expect(Number(mm.cashPct)).toBe(1);
  });

  it("suggests a stand-in for a fund SEC doesn't list, and fetches nothing until confirmed", async () => {
    expect(security("plan")).toMatchObject({
      factsBasis: "standin",
      factsSeriesId: "S4",
      standinConfirmedAt: null,
      ticker: null,
    });
    expect(facts("plan")).toHaveLength(0);
    ctx.db
      .update(ctx.schema.securities)
      .set({ standinConfirmedAt: new Date() })
      .where(eq(ctx.schema.securities.id, ids.plan!))
      .run();
    await syncSecurityFacts(ctx.rawDb, {
      force: true,
      now: new Date("2026-10-02T00:00:00Z"),
    });
    expect(
      Number(
        facts("plan").find((f) => f.source === "sec_nport")!.intlEquityPct,
      ),
    ).toBe(1);
  });

  it("doesn't download filings it already has", async () => {
    await syncSecurityFacts(ctx.rawDb, {
      force: true,
      now: new Date("2026-10-03T00:00:00Z"),
    });
    expect(sec.nportCalls).toBe(0);
  });

  it("stops the whole run when SEC throttles, keeping stored facts", async () => {
    const before = facts("target").length;
    sec.rateLimited = true;
    const r = await syncSecurityFacts(ctx.rawDb, {
      force: true,
      now: new Date("2026-10-04T00:00:00Z"),
    });
    expect(r.stoppedBySec).toBe(true);
    expect(facts("target")).toHaveLength(before);
    expect((await getSecFactsStatus(ctx.rawDb)).lastError).toMatch(
      /Stopped this run/,
    );
  });

  it("does nothing without an SEC contact", async () => {
    ctx.db.delete(ctx.schema.apiConnections).run();
    const r = await syncSecurityFacts(ctx.rawDb, { force: true });
    expect(r.checked).toBe(0);
  });
});
