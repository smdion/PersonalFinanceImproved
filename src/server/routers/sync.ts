// Sync router — budget API connection management and data synchronization.
// Split into domain sub-routers for maintainability; merged flat to preserve API surface.

import { mergeRouters } from "../trpc";
import { syncConnectionsRouter } from "./sync-connections";
import { syncCoreRouter } from "./sync-core";
import { syncConfigRouter } from "./sync-config";
import { syncNamesRouter } from "./sync-names";
import { syncMappingsRouter } from "./sync-mappings";

export const syncRouter = mergeRouters(
  syncConnectionsRouter,
  syncCoreRouter,
  syncConfigRouter,
  syncNamesRouter,
  syncMappingsRouter,
);
