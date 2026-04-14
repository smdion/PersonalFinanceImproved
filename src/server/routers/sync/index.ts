/** Sync router that merges connection, core sync, config, name-matching, and account-mapping sub-routers into a flat API surface for budget API synchronization. */

import { mergeRouters } from "../../trpc";
import { syncConnectionsRouter } from "./connections";
import { syncCoreRouter } from "./core";
import { syncConfigRouter } from "./config";
import { syncNamesRouter } from "./names";
import { syncMappingsRouter } from "./mappings";

export const syncRouter = mergeRouters(
  syncConnectionsRouter,
  syncCoreRouter,
  syncConfigRouter,
  syncNamesRouter,
  syncMappingsRouter,
);
