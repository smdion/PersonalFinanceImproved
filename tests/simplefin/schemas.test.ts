/**
 * SimpleFIN's response schemas through the real client: every known-good
 * answer is read, a broken one fails as bad-response naming its field, and
 * one broken account among good ones is left out and errored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";
import { claimSetupToken, getAccounts } from "@/lib/simplefin/client";
import { BudgetApiError } from "@/lib/budget-api/errors";
import { zDecimal } from "@/lib/utils/zod-fields";
import {
  sfAccount,
  sfAccountSet,
  sfHolding,
  sfTransaction,
  sfV1AccountSet,
} from "../fixtures/simplefin-protocol";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function textResponse(body: string, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(body),
  });
}
const jsonResponse = (data: unknown) => textResponse(JSON.stringify(data));

const ACCESS_URL = "https://u:p@bridge.simplefin.org/simplefin";
const full = { startDate: new Date("2026-05-01T00:00:00Z") };

async function read(body: unknown, options = full) {
  mockFetch.mockReturnValueOnce(jsonResponse(body));
  return getAccounts(ACCESS_URL, options);
}

/** The bad-response a body fails with (and that it fails with one). */
async function badResponse(body: unknown): Promise<BudgetApiError> {
  const err = await read(body).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(BudgetApiError);
  expect((err as BudgetApiError).code).toBe("bad-response");
  return err as BudgetApiError;
}

const withAccount = (overrides: Record<string, unknown>) =>
  sfAccountSet({ accounts: [sfAccount(overrides)] });

beforeEach(() => mockFetch.mockReset());

describe("known-good answers", () => {
  it("reads the protocol's v2 answer, holdings and transactions included", async () => {
    const r = await read(sfAccountSet());
    expect(r.providerErrors).toEqual([]);
    expect(r.accounts).toEqual([
      {
        id: "ACT-1",
        name: "Savings",
        balance: 100.23,
        orgName: "My Bank",
        balanceDate: new Date(1778000000 * 1000),
        holdings: [
          {
            symbol: "EXMPX",
            description: "Example Index Fund",
            shares: 10.5,
            marketValue: 1050,
            costBasisPerShare: 80.25,
          },
        ],
        transactions: [
          {
            id: "TRN-1",
            posted: 1777900000,
            transactedAt: 1777890000,
            amount: -33293.43,
            description: "Uncle Frank's Bait Shop",
            pending: false,
          },
        ],
      },
    ]);
  });

  it("reads a v1 balances-only answer", async () => {
    const r = await read(sfV1AccountSet(), {} as typeof full);
    expect(r.accounts.map((a) => [a.id, a.balance, a.orgName])).toEqual([
      ["2930002", 100.23, ""],
      ["2930003", -12, "Example CU"],
    ]);
    expect(r.accounts.every((a) => a.holdings === null)).toBe(true);
  });

  it("reads what the protocol leaves optional when it's absent", async () => {
    const r = await read(
      withAccount({
        "balance-date": undefined,
        conn_id: undefined,
        conn_name: undefined,
        holdings: undefined,
        transactions: [
          sfTransaction({ transacted_at: undefined, pending: undefined }),
          sfTransaction({ id: "TRN-2", posted: 0, pending: true }),
        ],
      }),
    );
    const a = r.accounts[0]!;
    expect(a.balanceDate).toBeNull();
    expect(a.orgName).toBe("");
    expect(a.holdings).toBeNull();
    expect(a.transactions.map((t) => [t.transactedAt, t.pending])).toEqual([
      [null, false],
      [1777890000, true],
    ]);
  });

  it("a pending row with posted 0 is dated by when it happened, never 1970", async () => {
    const r = await read(
      withAccount({
        transactions: [
          sfTransaction({ id: "TRN-P", posted: 0, pending: true }),
        ],
      }),
    );
    expect(r.accounts[0]!.transactions[0]!.posted).toBe(1777890000);
    expect(r.accountIdsWithErrors).toEqual([]);
  });

  it("a row with posted 0 and no transacted_at is left out, and its account errored", async () => {
    const r = await read(
      withAccount({
        transactions: [
          sfTransaction(),
          sfTransaction({ id: "TRN-X", posted: 0, transacted_at: undefined }),
        ],
      }),
    );
    const a = r.accounts[0]!;
    expect(a.transactions.map((t) => t.id)).toEqual(["TRN-1"]);
    expect(r.accountIdsWithErrors).toEqual([a.id]);
    expect(r.providerErrors.join(" ")).toMatch(
      /posted: 0 \(pending\) with no transacted_at/,
    );
  });

  it.each([
    [
      "absent",
      { symbol: undefined, market_value: undefined, cost_basis: undefined },
    ],
    ["empty", { symbol: "", market_value: "", cost_basis: "" }],
    [
      "zero cost basis",
      { symbol: "", market_value: undefined, cost_basis: "0.00" },
    ],
  ])(
    "reads a holding with no ticker, value or cost basis sent (%s)",
    async (_label, overrides) => {
      const r = await read(withAccount({ holdings: [sfHolding(overrides)] }));
      expect(r.accountIdsWithErrors).toEqual([]);
      expect(r.accounts[0]!.holdings).toEqual([
        {
          symbol: "",
          description: "Example Index Fund",
          shares: 10.5,
          marketValue: null,
          costBasisPerShare: null,
        },
      ]);
    },
  );

  it("reads an errlist entry and a deprecated errors string", async () => {
    const r = await read(
      sfAccountSet({
        errors: ["Connection to Other Bank may need attention"],
        errlist: [
          {
            code: "con.auth",
            msg: "My Bank needs you to sign in",
            conn_id: "CON-1",
          },
        ],
      }),
    );
    expect(r.providerErrors).toEqual([
      "Connection to Other Bank may need attention",
      "My Bank needs you to sign in",
    ]);
    expect(r.accountIdsWithErrors).toEqual(["ACT-1"]);
  });
});

describe("an account whose own fields are broken fails as bad-response naming its field", () => {
  it.each([
    ["a number balance", { balance: 100.23 }, /balance: expected string/],
    [
      "a nested balance",
      { balance: { amount: "1" } },
      /balance: expected string/,
    ],
    [
      "an Infinity balance",
      { balance: "Infinity" },
      /balance: Must be a valid number/,
    ],
    ["a NaN balance", { balance: "NaN" }, /balance: Must be a valid number/],
    ["an empty balance", { balance: "" }, /balance: Must be a valid number/],
    [
      "a renamed balance",
      { balance: undefined, bal: "1" },
      /balance: expected string, received undefined/,
    ],
    [
      "a renamed id",
      { id: undefined, account_id: "x" },
      /\bid: expected string/,
    ],
    ["a renamed name", { name: undefined }, /name: expected string/],
    [
      "a string balance-date",
      { "balance-date": "1778000000" },
      /balance-date: expected number/,
    ],
  ])("%s", async (_label, overrides, field) => {
    const err = await badResponse(withAccount(overrides));
    expect(err.message).toMatch(/^SimpleFIN: \/accounts: /);
    expect(err.message).toMatch(field);
  });
});

describe("a broken holding or transaction doesn't block the balance", () => {
  it.each([
    [
      "shares renamed",
      { shares: undefined, quantity: "1" },
      /holdings\.1\.shares: expected string/,
    ],
    [
      "shares Infinity",
      { shares: "Infinity" },
      /holdings\.1\.shares: Must be a valid number/,
    ],
    [
      "market_value a number",
      { market_value: 1050 },
      /holdings\.1\.market_value/,
    ],
    [
      "cost_basis Infinity",
      { cost_basis: "Infinity" },
      /holdings\.1\.cost_basis/,
    ],
    [
      "description renamed",
      { description: undefined, name: "x" },
      /holdings\.1\.description: expected string/,
    ],
  ])(
    "a holding's %s: holdings unknown (null), account errored, balance read",
    async (_label, overrides, field) => {
      const r = await read(
        withAccount({
          holdings: [sfHolding({ symbol: "OTHER" }), sfHolding(overrides)],
        }),
      );
      const a = r.accounts[0]!;
      expect(a.balance).toBe(100.23);
      expect(a.holdings).toBeNull();
      expect(a.transactions).toHaveLength(1);
      expect(r.accountIdsWithErrors).toEqual(["ACT-1"]);
      expect(r.providerErrors).toHaveLength(1);
      expect(r.providerErrors[0]).toMatch(/^SimpleFIN: \/accounts: /);
      expect(r.providerErrors[0]).toMatch(field);
      expect(r.providerErrors[0]).toMatch(
        /\(account "Savings": holdings kept as last known\)$/,
      );
    },
  );

  it.each([
    [
      "amount renamed",
      { amount: undefined, value: "1" },
      /transactions\.1\.amount: expected string/,
    ],
    ["amount a number", { amount: -1.5 }, /transactions\.1\.amount/],
    [
      "amount empty",
      { amount: "" },
      /transactions\.1\.amount: Must be a valid number/,
    ],
    [
      "posted renamed",
      { posted: undefined, date: 1 },
      /transactions\.1\.posted/,
    ],
    ["id missing", { id: undefined }, /transactions\.1\.id/],
    [
      "description renamed",
      { description: undefined, memo: "x" },
      /transactions\.1\.description/,
    ],
  ])(
    "a transaction's %s: only that row left out, account errored, balance read",
    async (_label, overrides, field) => {
      const r = await read(
        withAccount({
          transactions: [
            sfTransaction(),
            sfTransaction({ id: "TRN-2", ...overrides }),
          ],
        }),
      );
      const a = r.accounts[0]!;
      expect(a.balance).toBe(100.23);
      expect(a.transactions.map((t) => t.id)).toEqual(["TRN-1"]);
      expect(a.holdings).toHaveLength(1);
      expect(r.accountIdsWithErrors).toEqual(["ACT-1"]);
      expect(r.providerErrors[0]).toMatch(field);
      expect(r.providerErrors[0]).toMatch(
        /\(account "Savings": those transactions left out\)$/,
      );
    },
  );

  it("names a field missing from every holding once, with a count", async () => {
    const r = await read(
      withAccount({
        holdings: [1, 2, 3].map(() => sfHolding({ shares: undefined })),
      }),
    );
    expect(r.providerErrors[0]).toMatch(/holdings\.0\.shares: .*\(\+2 more\)/);
  });
});

describe("one broken account among good ones", () => {
  it("is left out and errored; the others are read", async () => {
    const r = await read(
      sfAccountSet({
        accounts: [
          sfAccount(),
          sfAccount({ id: "ACT-2", name: "Brokerage", balance: 12.5 }),
          sfAccount({ id: "ACT-3", name: "Checking", balance: "5.00" }),
        ],
      }),
    );
    expect(r.accounts.map((a) => a.id)).toEqual(["ACT-1", "ACT-3"]);
    expect(r.accountIdsWithErrors).toEqual(["ACT-2"]);
    expect(r.providerErrors).toEqual([
      'SimpleFIN: /accounts: balance: expected string, received number (account "Brokerage", not updated this sync)',
    ]);
  });

  it("without a readable id or name, is reported by position", async () => {
    const r = await read(
      sfAccountSet({ accounts: [sfAccount(), { balance: "1.00" }] }),
    );
    expect(r.accounts.map((a) => a.id)).toEqual(["ACT-1"]);
    expect(r.accountIdsWithErrors).toEqual([]);
    expect(r.providerErrors[0]).toMatch(/\(account #2 of 2, not updated/);
  });
});

describe("a broken envelope fails the whole call", () => {
  it.each([
    [
      "accounts renamed",
      { accounts: undefined, accts: [sfAccount()] },
      /^SimpleFIN: \/accounts: accounts: expected array \(or errors saying why not\)$/,
    ],
    [
      "accounts not an array",
      { accounts: { "ACT-1": sfAccount() } },
      /accounts: expected array/,
    ],
    [
      "errors not strings",
      { errors: [{ msg: "x" }] },
      /errors\.0: expected string/,
    ],
    ["errors not an array", { errors: "down" }, /errors: expected array/],
    [
      "an errlist entry without msg",
      { errlist: [{ code: "gen" }] },
      /errlist\.0\.msg: expected string/,
    ],
    [
      "a connection without a name",
      { connections: [{ conn_id: "CON-1" }] },
      /connections\.0\.name: expected string/,
    ],
    ["a body that isn't an object", null, /\(body\): expected object/],
  ])("%s", async (_label, overrides, field) => {
    const body =
      overrides === null
        ? null
        : sfAccountSet(overrides as Record<string, unknown>);
    const err = await badResponse(body);
    expect(err.message).toMatch(field);
  });

  it("an answer that is only errors keeps the provider's message", async () => {
    const err = await read({
      errlist: [{ code: "gen.auth", msg: "Your SimpleFIN access was revoked" }],
    }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BudgetApiError);
    expect((err as Error).message).toBe(
      "SimpleFIN provider error: Your SimpleFIN access was revoked",
    );
  });

  it("when no account fits, says so along with what SimpleFIN said", async () => {
    const err = await badResponse(
      sfAccountSet({
        errlist: [{ code: "con.auth", msg: "My Bank needs you to sign in" }],
        accounts: [sfAccount({ balance: 1 })],
      }),
    );
    expect(err.message).toBe(
      'SimpleFIN: /accounts: balance: expected string, received number (account "Savings", not updated this sync); SimpleFIN said: My Bank needs you to sign in',
    );
  });

  it("a 200 that isn't JSON", async () => {
    mockFetch.mockReturnValueOnce(textResponse("<html>Sign in</html>"));
    await expect(getAccounts(ACCESS_URL, full)).rejects.toMatchObject({
      code: "bad-response",
      message: "SimpleFIN: /accounts: not JSON",
    });
  });

  it("is fetched once, never retried", async () => {
    mockFetch.mockReturnValue(jsonResponse({ accounts: "none" }));
    await expect(getAccounts(ACCESS_URL)).rejects.toMatchObject({
      code: "bad-response",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("replayed answers are checked like live ones", () => {
  const dir = path.join(os.tmpdir(), `simplefin-replay-schemas-${process.pid}`);

  async function replay(files: Record<string, unknown>) {
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files))
      await fsp.writeFile(path.join(dir, name), JSON.stringify(body));
    vi.stubEnv("SIMPLEFIN_REPLAY_DIR", dir);
    vi.stubEnv("NODE_ENV", "development");
    try {
      return await getAccounts(ACCESS_URL, full);
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("a broken saved answer fails as bad-response", async () => {
    await expect(
      replay({ "a.json": sfAccountSet(), "b.json": { accounts: 3 } }),
    ).rejects.toMatchObject({
      code: "bad-response",
      message: expect.stringMatching(/accounts: expected array/),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("a broken saved account is errored, and connections are kept", async () => {
    const r = await replay({
      "a.json": sfAccountSet(),
      "b.json": { accounts: [sfAccount({ id: "ACT-9", balance: "" })] },
    });
    expect(r.accounts.map((a) => [a.id, a.orgName])).toEqual([
      ["ACT-1", "My Bank"],
    ]);
    expect(r.accountIdsWithErrors).toEqual(["ACT-9"]);
  });
});

describe("claimSetupToken", () => {
  const token = Buffer.from("https://bridge.simplefin.org/claim/abc").toString(
    "base64",
  );

  it("refuses a 200 that isn't an access URL, without echoing it", async () => {
    mockFetch.mockReturnValueOnce(textResponse("<html>Oops</html>"));
    const err = await claimSetupToken(token).catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "bad-response",
      message:
        "SimpleFIN: /claim: (body): expected an https access URL with credentials",
    });
  });

  it("refuses an access URL without credentials", async () => {
    mockFetch.mockReturnValueOnce(
      textResponse("https://bridge.simplefin.org/simplefin"),
    );
    await expect(claimSetupToken(token)).rejects.toMatchObject({
      code: "bad-response",
    });
  });
});

describe("zDecimal", () => {
  it.each(["100.23", "-12", "0", "1e3", " 5 "])("accepts %j", (v) => {
    expect(zDecimal.safeParse(v).success).toBe(true);
  });

  it.each(["", "  ", "NaN", "Infinity", "-Infinity", "1e400", "abc"])(
    "refuses %j",
    (v) => {
      expect(zDecimal.safeParse(v).success).toBe(false);
    },
  );
});
