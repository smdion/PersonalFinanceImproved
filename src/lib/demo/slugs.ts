/** The demo profiles' slugs, in the order the chooser lists them. */
export const DEMO_PROFILE_SLUGS = [
  "single-income",
  "dual-income-family",
  "early-retirement",
  "debt-payoff",
  "recently-retired",
] as const;

/** A demo profile's slug. */
export type DemoProfileSlug = (typeof DEMO_PROFILE_SLUGS)[number];

const SLUGS: ReadonlySet<string> = new Set(DEMO_PROFILE_SLUGS);

/** Whether `slug` is a demo profile's slug (never an inherited name such
 *  as `constructor`). */
export function isDemoProfileSlug(slug: string): slug is DemoProfileSlug {
  return SLUGS.has(slug);
}

/** The Postgres schema of the demo profile `slug` names, or null when it
 *  names none. */
export function demoSchemaName(slug: string): string | null {
  return isDemoProfileSlug(slug) ? `demo_${slug.replace(/-/g, "_")}` : null;
}
