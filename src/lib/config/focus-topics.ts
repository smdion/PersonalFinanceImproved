/**
 * Links that land on the data — the one table every "take me to this" link
 * reads (RULES.md § Links into Pages).
 *
 * A sender says what a link is about (a `Focus`); this table says where that
 * lives and how its page must open to show it. Pages opt in with
 * `useFocusedState` (tabs/views), `useFocusMatch` (reveal a hidden section)
 * and `FocusTarget` (scroll + highlight).
 */
import { settingsHref, type SettingsSectionsByTab } from "./settings-sections";

/** Query params a focus link uses. */
export const FOCUS_PARAM = "focus";
export const FOCUS_ID_PARAM = "focusId";

// --- Page state a focus can set (each page reads its own key) ---

export const TAX_BUCKET_VIEWS = ["now", "atRetirement"] as const;
export const RETIREMENT_TABS = [
  "projection",
  "comparison",
  "planHealth",
] as const;
export const SAVINGS_MASTER_TABS = ["plan", "manage"] as const;
export const SAVINGS_EDIT_TABS = [
  "allocations",
  "transactions",
  "extraPaychecks",
] as const;

export const FOCUS_STATE = {
  taxBucketsView: TAX_BUCKET_VIEWS,
  retirementTab: RETIREMENT_TABS,
  savingsMasterTab: SAVINGS_MASTER_TABS,
  savingsEditTab: SAVINGS_EDIT_TABS,
} as const;

export type FocusStateKey = keyof typeof FOCUS_STATE;
export type FocusStateValue<S extends FocusStateKey> =
  (typeof FOCUS_STATE)[S][number];
type FocusState = Partial<{ [S in FocusStateKey]: FocusStateValue<S> }>;

// --- Topics: what a link is about (named for the data, never a page) ---

type SettingsFocus = {
  [T in keyof SettingsSectionsByTab]: {
    topic: "settings";
    tab: T;
    section?: SettingsSectionsByTab[T];
  };
}[keyof SettingsSectionsByTab];

export type Focus =
  /** Money reachable vs locked by early-withdrawal rules at retirement. */
  | { topic: "earlyAccess" }
  /** The Retirement page's plan diagnostics. */
  | { topic: "planHealth" }
  /** One year of the retirement projection. */
  | { topic: "projectionYear"; year: number }
  /** Where extra-paycheck routing is set up. */
  | { topic: "extraPaychecks" }
  /** Each account's past funds. */
  | { topic: "holdingHistory" }
  /** Account & contribution settings (Portfolio). */
  | { topic: "portfolioAccounts" }
  | SettingsFocus;

export type FocusKey = Focus["topic"];
export type FocusOf<K extends FocusKey> = Extract<Focus, { topic: K }>;
/** A topic's id fields (empty for topics without one). */
export type FocusIds<K extends FocusKey> = Omit<FocusOf<K>, "topic">;

type FocusHome<K extends FocusKey> = {
  route: string;
  /** Page state the page must open in to show this topic. */
  state?: FocusState;
  /** "section": a FocusTarget/useFocusMatch marks it on the page.
   *  "page": the page itself (no section yet). */
  target: "section" | "page";
  /** Topics with an id: its one URL value, and back. */
  id?: {
    of: (f: FocusOf<K>) => string;
    parse: (value: string) => FocusIds<K> | null;
  };
  /** A home with its own link scheme (Settings). */
  href?: (f: FocusOf<K>) => string;
};

const positiveInt = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const FOCUS_HOMES: { [K in FocusKey]: FocusHome<K> } = {
  earlyAccess: {
    route: "/tax-buckets",
    state: { taxBucketsView: "atRetirement" },
    target: "section",
  },
  planHealth: {
    route: "/retirement",
    state: { retirementTab: "planHealth" },
    target: "page",
  },
  projectionYear: {
    route: "/retirement",
    state: { retirementTab: "projection" },
    target: "section",
    id: {
      of: (f) => String(f.year),
      parse: (v) => {
        const year = positiveInt(v);
        return year === null ? null : { year };
      },
    },
  },
  extraPaychecks: {
    route: "/savings",
    state: { savingsMasterTab: "plan", savingsEditTab: "extraPaychecks" },
    target: "section",
  },
  holdingHistory: { route: "/portfolio", target: "section" },
  portfolioAccounts: { route: "/portfolio", target: "section" },
  settings: {
    route: "/settings",
    target: "section",
    href: (f) => settingsHref(f.tab, f.section as never),
  },
};

export function isFocusKey(value: string | null): value is FocusKey {
  return value !== null && Object.hasOwn(FOCUS_HOMES, value);
}

/** The link for a focus — the only way a sender builds one. */
export function focusHref(focus: Focus): string {
  const home = FOCUS_HOMES[focus.topic] as FocusHome<typeof focus.topic>;
  if (home.href) return home.href(focus as never);
  const qs = new URLSearchParams({ [FOCUS_PARAM]: focus.topic });
  if (home.id) qs.set(FOCUS_ID_PARAM, home.id.of(focus as never));
  return `${home.route}?${qs.toString()}`;
}

/** The page state a focus asks for, if any. */
export function focusStateFor<S extends FocusStateKey>(
  topic: FocusKey | null,
  key: S,
): FocusStateValue<S> | undefined {
  if (!topic) return undefined;
  return FOCUS_HOMES[topic].state?.[key] as FocusStateValue<S> | undefined;
}

/** A topic's ids from the URL value — null when missing or stale. */
export function parseFocusIds<K extends FocusKey>(
  topic: K,
  value: string | null,
): FocusIds<K> | null {
  const home = FOCUS_HOMES[topic] as FocusHome<K>;
  if (!home.id) return {} as FocusIds<K>;
  return value === null ? null : home.id.parse(value);
}
