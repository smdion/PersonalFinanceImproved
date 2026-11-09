/**
 * Data Browser server page: prefetches dataBrowser.listTables (no input). It's
 * adminProcedure, so for non-admins the prefetch fails and the catch swallows it.
 */

import { HydrationBoundary } from "@tanstack/react-query";
import { prefetchForPage } from "@/server/trpc-server";
import { DataBrowserContent } from "./data-browser-content";

export default async function DataBrowserPage() {
  const dehydratedState = await prefetchForPage(async (helpers) => {
    await helpers.dataBrowser.listTables.prefetch().catch(() => undefined);
  });

  return (
    <HydrationBoundary state={dehydratedState}>
      <DataBrowserContent />
    </HydrationBoundary>
  );
}
