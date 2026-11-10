/**
 * Invented budget-app account mappings for the credentials tag's mapping
 * step: one per stored form a mapping can hold. `after` is the mapping the
 * tag leaves (the same object when unchanged). Each one's pull target (the
 * Ledgr row a pulled balance is written into) and push target read the
 * same before and after, except O8's two: an untyped `performance:N` is
 * pushed after the tag, and an unmatched plain name stays as stored.
 */
type Mapping = Record<string, unknown>;

const m = (remote: string, fields: Mapping): Mapping => ({
  remoteAccountId: remote,
  syncDirection: "pull",
  localName: "Invented",
  ...fields,
});

export const ASSETS = [
  { id: 10, name: "Invented boat", year: 2024, value: "1000.00" },
  { id: 11, name: "Invented boat", year: 2025, value: "1200.00" },
  { id: 12, name: "Invented car", year: 2025, value: "900.00" },
];

export type MappingCase = {
  readonly what: string;
  readonly before: Mapping;
  readonly after: Mapping;
};

const same = (what: string, before: Mapping): MappingCase => ({
  what,
  before,
  after: before,
});

export const MAPPING_CASES: readonly MappingCase[] = [
  {
    what: "an untyped performance id (pushed after: O8)",
    before: m("r0", { localId: "performance:7", syncDirection: "push" }),
    after: m("r0", {
      localId: "performance:7",
      syncDirection: "push",
      performanceAccountId: 7,
    }),
  },
  {
    what: "an untyped asset id",
    before: m("r1", { localId: "asset:12" }),
    after: m("r1", { localId: "asset:12", assetId: 12 }),
  },
  {
    what: "an untyped debt id",
    before: m("r2", { localId: "debt:4" }),
    after: m("r2", { localId: "debt:4", debtId: 4 }),
  },
  {
    what: "an untyped loan id",
    before: m("r3", { localId: "mortgage:2:loanBalance" }),
    after: m("r3", {
      localId: "mortgage:2:loanBalance",
      loanId: 2,
      loanMapType: "loanBalance",
    }),
  },
  {
    what: "a loan id in the name only",
    before: m("r4", { localName: "mortgage:2:propertyValue" }),
    after: m("r4", {
      localName: "mortgage:2:propertyValue",
      localId: "mortgage:2:propertyValue",
      loanId: 2,
      loanMapType: "propertyValue",
    }),
  },
  {
    what: "a debt id in the name only",
    before: m("r5", { localName: "debt:6" }),
    after: m("r5", { localName: "debt:6", localId: "debt:6", debtId: 6 }),
  },
  {
    what: "a plain asset name (the latest year's row)",
    before: m("r6", { localName: "Invented boat" }),
    after: m("r6", {
      localName: "Invented boat",
      localId: "asset:11",
      assetId: 11,
    }),
  },
  same(
    "a plain name no asset holds (O8: left)",
    m("r7", { localName: "Invented nothing" }),
  ),
  same(
    "the Cash pseudo-account",
    m("r8", { localId: "cash", localName: "Cash" }),
  ),
  same("a typed asset", m("r9", { localId: "asset:12", assetId: 12 })),
  {
    what: "a loan with its id typed and its field not",
    before: m("r10", { localId: "mortgage:2:loanBalance", loanId: 9 }),
    after: m("r10", {
      localId: "mortgage:2:loanBalance",
      loanId: 9,
      loanMapType: "loanBalance",
    }),
  },
  same("a malformed id (reported to re-map)", m("r11", { localId: "debt:5x" })),
  same("an unknown prefix", m("r12", { localId: "invented:3" })),
];

/** The connections: one holding every case, one with no mappings, one
 *  with an empty list. */
export const CONNECTIONS = [
  { id: 1, service: "ynab", mappings: MAPPING_CASES.map((c) => c.before) },
  { id: 2, service: "actual", mappings: null },
  { id: 3, service: "invented", mappings: [] },
];

export const AFTER = MAPPING_CASES.map((c) => c.after);
