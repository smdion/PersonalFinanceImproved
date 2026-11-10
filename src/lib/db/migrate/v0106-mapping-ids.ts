/** The credentials tag's mapping step, live and on restore: a budget-app
 *  mapping naming its target only by an id prefix or an asset's name gets
 *  the typed id the readers read. Rules: MAPPING_IDS_CONVERTER. */
// No import from migration-converters.ts, which registers this one.
import {
  isEmpty,
  isRow,
  jsonArray,
  type Row,
  type Update,
} from "./converter-rows";

const CONNECTIONS = "api_connections";
const ASSETS = "other_asset_items";

/** The pseudo-accounts a mapping names by `localId`: no typed id exists. */
const PSEUDO_ACCOUNTS = new Set(["cash", "creditCard"]);
const LOAN_FIELDS = new Set(["propertyValue", "loanBalance"]);
/** The prefixes the readers parsed (frozen): one of these the parse refuses
 *  (`debt:5x`) named no account, and is reported to re-map. */
const KNOWN_PREFIXES = new Set(["performance", "asset", "debt", "mortgage"]);
/** The typed ids a mapping can carry (json-schemas.ts accountMappingSchema). */
const TYPED = ["performanceAccountId", "assetId", "debtId", "loanId"];

const wholeNumber = (text: string | undefined) =>
  text !== undefined && /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;

/** The typed ids a prefixed id names (mappingWithTypedIds's parse as this
 *  tag found it, frozen), each only where the mapping lacks it; null when
 *  it names none or the mapping already has them. */
function fromPrefix(id: string, m: Row): Row | null {
  const [kind, first, second, ...rest] = id.split(":");
  const n = wholeNumber(first);
  if (n === null || rest.length > 0) return null;
  const field =
    kind === "performance"
      ? "performanceAccountId"
      : kind === "asset"
        ? "assetId"
        : kind === "debt"
          ? "debtId"
          : null;
  if (field !== null)
    return second === undefined && isEmpty(m[field]) ? { [field]: n } : null;
  if (kind !== "mortgage" || second === undefined) return null;
  if (!LOAN_FIELDS.has(second)) return null;
  if (!isEmpty(m["loanId"]) && !isEmpty(m["loanMapType"])) return null;
  // The pull reads a stored half before the prefix's.
  return {
    loanId: isEmpty(m["loanId"]) ? n : m["loanId"],
    loanMapType: isEmpty(m["loanMapType"]) ? second : m["loanMapType"],
  };
}

/** The asset a plain name names: the latest year's row of that exact name
 *  (rows are per name and year); the lowest id breaks a tie. */
function assetNamed(assets: readonly Row[], name: string): number | null {
  let best: Row | null = null;
  for (const a of assets) {
    if (a["name"] !== name) continue;
    const newer =
      best === null ||
      Number(a["year"]) > Number(best["year"]) ||
      (Number(a["year"]) === Number(best["year"]) &&
        Number(a["id"]) < Number(best["id"]));
    if (newer) best = a;
  }
  return best === null ? null : Number(best["id"]);
}

type Outcome = { mapping: Row | null; unmatched: boolean };
const UNCHANGED: Outcome = { mapping: null, unmatched: false };

/** One mapping after the tag, read as the pull read it (`localId ??
 *  localName`, the asset by `localName`); `mapping` null when unchanged. */
function converted(m: Row, assets: readonly Row[]): Outcome {
  const text = (key: string) => (typeof m[key] === "string" ? m[key] : "");
  const localId = text("localId");
  const localName = text("localName");
  const id = localId !== "" ? localId : localName;
  if (id === "" || PSEUDO_ACCOUNTS.has(id)) return UNCHANGED;
  const typed = fromPrefix(id, m);
  if (typed)
    return { mapping: { ...m, localId: id, ...typed }, unmatched: false };
  if (/^[a-z]+:/.test(id)) {
    const kind = id.slice(0, id.indexOf(":"));
    const typedAlready = TYPED.some((f) => !isEmpty(m[f]));
    return KNOWN_PREFIXES.has(kind) && !typedAlready
      ? { mapping: null, unmatched: true }
      : UNCHANGED;
  }
  if (TYPED.some((f) => !isEmpty(m[f]))) return UNCHANGED;
  const assetId = assetNamed(assets, localName);
  if (assetId === null) return { mapping: null, unmatched: true };
  return {
    mapping: { ...m, localId: `asset:${assetId}`, assetId },
    unmatched: false,
  };
}

/** Idempotent by structure: a mapping is written only where the typed id
 *  its prefix (or asset name) names is empty, and a converted one has it.
 *  An unmatched plain name is left as stored and reported (ids only). */
export const MAPPING_IDS_CONVERTER = {
  tables: [CONNECTIONS, ASSETS],
  runs: "afterSql",
  convert: (
    tables: Readonly<Record<string, readonly unknown[] | undefined>>,
  ) => {
    const assets = (tables[ASSETS] ?? []).filter(isRow);
    const updates: Update[] = [];
    const unmatched: string[] = [];
    let mappings = 0;
    for (const c of (tables[CONNECTIONS] ?? []).filter(isRow)) {
      const list = jsonArray(c["account_mappings"]);
      if (!list) continue;
      const next = list.map((m, i) => {
        if (!isRow(m)) return m;
        const out = converted(m, assets);
        if (out.unmatched) unmatched.push(`${String(c["id"])}#${i}`);
        if (!out.mapping) return m;
        mappings++;
        return out.mapping;
      });
      if (next.some((m, i) => m !== list[i]))
        updates.push({
          table: CONNECTIONS,
          id: Number(c["id"]),
          set: { account_mappings: next },
        });
    }
    const notes = [`${mappings} account mappings given their typed id`];
    if (unmatched.length > 0)
      notes.push(
        `${unmatched.length} mappings name no Ledgr account (a name no asset holds, or a malformed id), left to re-map (connection#mapping): ${unmatched.join(", ")}`,
      );
    return { updates, notes };
  },
} as const;
