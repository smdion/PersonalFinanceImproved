// The budget apps Ledgr connects to, with no Zod so client components can
// read the list and labels; budgetApiServiceSchema is in enum-values.schema.ts.

/** Every per-service list derives from these keys;
 *  `lib/budget-api/providers.ts` adds each one's client. */
export const BUDGET_API_SERVICE_VALUES = ["ynab", "actual"] as const;
export type BudgetApiService = (typeof BUDGET_API_SERVICE_VALUES)[number];
/** Each service's display name. */
export const BUDGET_SERVICES = {
  ynab: { label: "YNAB" },
  actual: { label: "Actual Budget" },
} as const satisfies Record<BudgetApiService, { label: string }>;
/** True for a known service key (a stored setting can hold anything). */
export function isBudgetApiService(value: unknown): value is BudgetApiService {
  return typeof value === "string" && Object.hasOwn(BUDGET_SERVICES, value);
}
