// Unit conversion helpers for budget API clients.
// YNAB uses milliunits (1000 = $1.00), Actual uses integer cents (100 = $1.00).

/** Convert YNAB milliunits to dollars */
export function fromMilliunits(milliunits: number): number {
  return milliunits / 1000;
}

/** Convert dollars to YNAB milliunits */
export function toMilliunits(dollars: number): number {
  return Math.round(dollars * 1000);
}

/** Convert Actual Budget integer cents to dollars */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Convert dollars to Actual Budget integer cents */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}
