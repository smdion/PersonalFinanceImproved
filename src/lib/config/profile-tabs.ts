/** Profiles page tabs, in dependency order (Salary → Contributions → the
 *  Budget, on its own page → Savings; Retirement and What-If consume them).
 *  The tab is in the URL: /profiles?tab=<key>. */
export const PROFILE_TABS = [
  { key: "salary", label: "Salary" },
  { key: "contributions", label: "Contributions" },
  { key: "savings", label: "Savings" },
  { key: "retirement", label: "Retirement" },
  { key: "whatif", label: "What-If" },
] as const;

export type ProfileTabKey = (typeof PROFILE_TABS)[number]["key"];

export const profilesHref = (tab: ProfileTabKey) => `/profiles?tab=${tab}`;
