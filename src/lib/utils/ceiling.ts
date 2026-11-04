/** An upper bound, or none. "No limit" and a limit of 0 are different. */
export type Ceiling<T extends number = number> =
  { readonly kind: "none" } | { readonly kind: "at"; readonly amount: T };

/** A stored cap, where 0 or unset means no cap. */
export function storedCeiling(value: number | null | undefined): Ceiling {
  return value != null && value > 0
    ? { kind: "at", amount: value }
    : { kind: "none" };
}

export function applyCeiling(value: number, ceiling: Ceiling): number {
  return ceiling.kind === "none" ? value : Math.min(value, ceiling.amount);
}
