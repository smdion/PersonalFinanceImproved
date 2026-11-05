/**
 * Barrel re-export — all helper modules.
 * Consumers can import everything from '@/server/helpers' or drill into submodules.
 */
export * from "@/lib/pure/paycheck/budget-periods";
export * from "@/lib/pure/household/app-settings";
export * from "@/lib/pure/household/compensation";
export * from "./budget";
export * from "@/lib/pure/debts/mortgage-balance";
export * from "./snapshot";
export * from "@/server/services/sync/api-balance-resolution";
export * from "@/server/services/sync/budget-api-push";
export * from "./savings-allocation";
export * from "@/lib/pure/paycheck/paycheck-input";
export * from "@/lib/pure/accounts/portfolio-labels";
export * from "@/server/data/category-links";
export * from "@/server/data/people";

// Canonical implementation lives in @/lib/utils/format — re-export for server-side consumers
