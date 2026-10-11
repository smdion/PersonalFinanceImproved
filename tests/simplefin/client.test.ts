import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function textResponse(body: string, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  });
}

function jsonResponse(data: unknown, status = 200) {
  return textResponse(JSON.stringify(data), status);
}

describe("claimSetupToken", () => {
  beforeEach(() => mockFetch.mockReset());

  it("decodes the base64 token, POSTs to the claim URL, and returns the trimmed access URL", async () => {
    const claimUrl = "https://bridge.simplefin.org/simplefin/claim/abc123";
    const setupToken = Buffer.from(claimUrl).toString("base64");
    mockFetch.mockReturnValueOnce(
      textResponse("https://user:pass@bridge.simplefin.org/simplefin\n"),
    );

    const accessUrl = await claimSetupToken(setupToken);

    expect(accessUrl).toBe("https://user:pass@bridge.simplefin.org/simplefin");
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(claimUrl);
    expect(init.method).toBe("POST");
  });

  it("throws a typed error when the claim fails", async () => {
    const setupToken = Buffer.from("https://bridge.example/claim/x").toString(
      "base64",
    );
    mockFetch.mockReturnValueOnce(textResponse("invalid token", 400));

    await expect(claimSetupToken(setupToken)).rejects.toThrow(/400/);
  });
});

describe("getAccounts", () => {
  beforeEach(() => mockFetch.mockReset());

  it("parses credentials out of the access URL and requests balances-only", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        accounts: [
          {
            id: "acct-1",
            name: "Checking",
            balance: "1234.56",
            org: { name: "Test Bank" },
          },
        ],
      }),
    );

    const { accounts, providerErrors } = await getAccounts(
      "https://myuser:mypass@bridge.simplefin.org/simplefin",
    );

    expect(accounts).toEqual([
      {
        id: "acct-1",
        name: "Checking",
        balance: 1234.56,
        orgName: "Test Bank",
        balanceDate: null,
        // Balances-only responses carry no holdings field at all.
        holdings: null,
        transactions: [],
      },
    ]);
    expect(providerErrors).toEqual([]);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://bridge.simplefin.org/simplefin/accounts?balances-only=1",
    );
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("myuser:mypass").toString("base64")}`,
    );
  });

  it("defaults orgName to empty string when org is missing", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        accounts: [{ id: "a1", name: "Savings", balance: "0" }],
      }),
    );
    const { accounts } = await getAccounts("https://u:p@bridge.simplefin.org");
    expect(accounts[0]!.orgName).toBe("");
  });

  it("returns an empty array when the response has no accounts", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    const { accounts } = await getAccounts("https://u:p@bridge.simplefin.org");
    expect(accounts).toEqual([]);
  });

  it("throws a typed auth error on 401", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ errors: ["bad creds"] }, 401));
    await expect(
      getAccounts("https://u:p@bridge.simplefin.org"),
    ).rejects.toThrow(/Authentication failed.*401/);
  });

  it("returns accounts alongside providerErrors on a partial provider failure, instead of discarding them", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        errors: ["Institution X needs re-authentication"],
        accounts: [{ id: "a1", name: "Checking", balance: "500" }],
      }),
    );
    const { accounts, providerErrors } = await getAccounts(
      "https://u:p@bridge.simplefin.org",
    );
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.balance).toBe(500);
    expect(providerErrors).toEqual(["Institution X needs re-authentication"]);
  });

  it("throws when errors are present and no accounts came back", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ errors: ["Institution X needs re-authentication"] }),
    );
    await expect(
      getAccounts("https://u:p@bridge.simplefin.org"),
    ).rejects.toThrow(/Institution X needs re-authentication/);
  });
});

describe("getAccounts — full request (holdings + transactions)", () => {
  beforeEach(() => mockFetch.mockReset());

  const startDate = new Date("2026-05-01T00:00:00Z");

  it("requests protocol v2 with pending rows from the start date", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ accounts: [] }));

    await getAccounts("https://u:p@bridge.simplefin.org/simplefin", {
      startDate,
    });

    expect(mockFetch.mock.calls[0]![0]).toBe(
      `https://bridge.simplefin.org/simplefin/accounts?version=2&pending=1&start-date=${startDate.getTime() / 1000}`,
    );
  });

  it("never retries a full request (every call counts against the daily quota)", async () => {
    mockFetch.mockReturnValue(textResponse("upstream error", 503));

    await expect(
      getAccounts("https://u:p@bridge.simplefin.org", { startDate }),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("parses balance date, holdings and transactions", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        accounts: [
          {
            id: "acct-9",
            name: "Example IRA",
            balance: "1500.00",
            "balance-date": 1778000000,
            org: { name: "Example Brokerage" },
            holdings: [
              {
                id: "h1",
                symbol: "EXMPX",
                description: "Example Index Fund",
                shares: "10.5",
                market_value: "1050.00",
                cost_basis: "80.25",
              },
              {
                id: "h2",
                symbol: "",
                description: "Example Plan Fund",
                shares: "3",
                market_value: "450.00",
                cost_basis: "0.00",
              },
            ],
            transactions: [
              {
                id: "t1",
                posted: 1777900000,
                amount: "100.00",
                description: "CONTRIBUTION",
              },
              {
                id: "t2",
                posted: 1777950000,
                amount: "-1.50",
                description: "FEE",
                pending: true,
              },
            ],
          },
        ],
      }),
    );

    const { accounts } = await getAccounts("https://u:p@bridge.simplefin.org", {
      startDate,
    });
    const a = accounts[0]!;

    expect(a.balanceDate).toEqual(new Date(1778000000 * 1000));
    expect(a.holdings).toEqual([
      {
        id: "h1",
        symbol: "EXMPX",
        description: "Example Index Fund",
        shares: 10.5,
        marketValue: 1050,
        costBasisPerShare: 80.25,
      },
      // A 0 cost basis means "not sent", not a free fund.
      {
        id: "h2",
        symbol: "",
        description: "Example Plan Fund",
        shares: 3,
        marketValue: 450,
        costBasisPerShare: null,
      },
    ]);
    expect(a.transactions).toEqual([
      {
        id: "t1",
        posted: 1777900000,
        transactedAt: null,
        amount: 100,
        description: "CONTRIBUTION",
        pending: false,
      },
      {
        id: "t2",
        posted: 1777950000,
        transactedAt: null,
        amount: -1.5,
        description: "FEE",
        pending: true,
      },
    ]);
  });

  it("reports v2 errlist entries and which accounts they name", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        errlist: [
          {
            code: "con.auth",
            msg: "Example Bank needs you to sign in again",
            account_id: "acct-2",
          },
        ],
        accounts: [{ id: "acct-1", name: "Ok", balance: "1.00" }],
      }),
    );

    const r = await getAccounts("https://u:p@bridge.simplefin.org", {
      startDate,
    });

    expect(r.providerErrors).toEqual([
      "Example Bank needs you to sign in again",
    ]);
    expect(r.accountIdsWithErrors).toEqual(["acct-2"]);
  });
});

describe("getAccounts — replay mode", () => {
  const dir = path.join(os.tmpdir(), `simplefin-replay-${process.pid}`);

  beforeEach(async () => {
    mockFetch.mockReset();
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "example.json"),
      JSON.stringify({
        accounts: [{ id: "replay-1", name: "Replayed", balance: "5.00" }],
      }),
    );
  });

  it("reads saved responses instead of calling SimpleFIN outside production", async () => {
    vi.stubEnv("SIMPLEFIN_REPLAY_DIR", dir);
    vi.stubEnv("NODE_ENV", "development");
    try {
      const r = await getAccounts("https://u:p@bridge.simplefin.org", {
        startDate: new Date(),
      });
      expect(r.accounts.map((a) => a.id)).toEqual(["replay-1"]);
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is ignored in production", async () => {
    vi.stubEnv("SIMPLEFIN_REPLAY_DIR", dir);
    vi.stubEnv("NODE_ENV", "production");
    mockFetch.mockReturnValueOnce(jsonResponse({ accounts: [] }));
    try {
      await getAccounts("https://u:p@bridge.simplefin.org", {
        startDate: new Date(),
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
