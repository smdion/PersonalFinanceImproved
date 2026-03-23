/** Sync router that merges connection, core sync, config, name-matching, and account-mapping sub-routers into a flat API surface for budget API synchronization. */

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
