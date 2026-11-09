// Drizzle schema — all table definitions for ledgr.
// This file is the single source of truth for the data model.
// See Migration Plan Section 4 for design principles and seed data notes.

// The tables live in ./pg/ by domain, re-exported here; keep this order. schema-sqlite.ts
// and ./sqlite/ are generated from them by `npx tsx scripts/gen-sqlite-schema.ts`.

export * from "./pg/shared";
export * from "./pg/people";
export * from "./pg/contributions";
export * from "./pg/budget";
export * from "./pg/savings";
export * from "./pg/brokerage";
export * from "./pg/self-loans";
export * from "./pg/performance";
export * from "./pg/net-worth";
export * from "./pg/mortgages";
export * from "./pg/retirement";
export * from "./pg/tax-tables";
export * from "./pg/api-sync";
export * from "./pg/app-config";
export * from "./pg/scenarios";
export * from "./pg/monte-carlo";
export * from "./pg/contribution-profiles";
export * from "./pg/state-versions";
