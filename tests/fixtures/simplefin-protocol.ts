/**
 * SimpleFIN answers as the protocol (https://www.simplefin.org/protocol.html)
 * and SimpleFIN Bridge send them: v2 with connections and errlist, v1 with
 * `org` on the account. Override what a test needs.
 */

export function sfHolding(overrides: Record<string, unknown> = {}) {
  return {
    id: "HOL-1",
    created: 1777900000,
    currency: "USD",
    symbol: "EXMPX",
    description: "Example Index Fund",
    shares: "10.5",
    market_value: "1050.00",
    cost_basis: "80.25",
    purchase_price: "0.00",
    ...overrides,
  };
}

export function sfTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "TRN-1",
    posted: 1777900000,
    amount: "-33293.43",
    description: "Uncle Frank's Bait Shop",
    transacted_at: 1777890000,
    pending: false,
    extra: { category: "food" },
    ...overrides,
  };
}

export function sfAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "ACT-1",
    name: "Savings",
    conn_id: "CON-1",
    conn_name: "My Bank",
    currency: "USD",
    balance: "100.23",
    "available-balance": "75.23",
    "balance-date": 1778000000,
    transactions: [sfTransaction()],
    holdings: [sfHolding()],
    extra: {},
    ...overrides,
  };
}

/** A v2 accounts answer: one connection, no errors. */
export function sfAccountSet(overrides: Record<string, unknown> = {}) {
  return {
    errlist: [],
    connections: [
      {
        conn_id: "CON-1",
        name: "My Bank",
        org_id: "ORG-1",
        org_name: "My Bank",
        org_url: "https://mybank.com",
        sfin_url: "https://sfin.mybank.com",
      },
    ],
    accounts: [sfAccount()],
    ...overrides,
  };
}

/** A v1 balances-only answer: the institution on the account, no
 *  connections, holdings or transactions. */
export function sfV1AccountSet() {
  return {
    errors: [],
    accounts: [
      {
        org: { domain: "mybank.com", "sfin-url": "https://sfin.mybank.com" },
        id: "2930002",
        name: "Savings",
        currency: "USD",
        balance: "100.23",
        "available-balance": "75.23",
        "balance-date": 978366153,
      },
      {
        org: { name: "Example CU", "sfin-url": "https://sfin.example" },
        id: "2930003",
        name: "Checking",
        currency: "USD",
        balance: "-12.00",
        "balance-date": 978366153,
      },
    ],
  };
}
