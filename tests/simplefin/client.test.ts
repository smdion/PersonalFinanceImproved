import { describe, it, expect, vi, beforeEach } from "vitest";
import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";

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

    const accounts = await getAccounts(
      "https://myuser:mypass@bridge.simplefin.org/simplefin",
    );

    expect(accounts).toEqual([
      {
        id: "acct-1",
        name: "Checking",
        balance: 1234.56,
        orgName: "Test Bank",
      },
    ]);
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
    const accounts = await getAccounts("https://u:p@bridge.simplefin.org");
    expect(accounts[0]!.orgName).toBe("");
  });

  it("returns an empty array when the response has no accounts", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({}));
    const accounts = await getAccounts("https://u:p@bridge.simplefin.org");
    expect(accounts).toEqual([]);
  });

  it("throws a typed auth error on 401", async () => {
    mockFetch.mockReturnValueOnce(jsonResponse({ errors: ["bad creds"] }, 401));
    await expect(
      getAccounts("https://u:p@bridge.simplefin.org"),
    ).rejects.toThrow(/Authentication failed.*401/);
  });
});
