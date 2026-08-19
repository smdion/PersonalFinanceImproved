/**
 * Data Browser server page (server-prefetch split, Phase 2 item 2i).
 *
 * Server-side prefetches dataBrowser.listTables — takes no input, so this
 * prefetch always matches the client's eventual query exactly. Admin-only
 * (adminProcedure): for a non-admin session the prefetch simply fails and
 * is swallowed by the catch below, same as any other error — the
 * procedure's own permission check is the enforcement point, not this
 * page. getColumns/getRows depend on the user's table selection and
 * aren't prefetchable.
 *
 * Prefetch failures don't block rendering — wrapped in try/catch so the
 * client falls back to its own fetch on error.
 */

import {
  HydrationBoundary,
  dehydrate,
  type DehydratedState,
} from "@tanstack/react-query";
import { createServerHelpers } from "@/server/helpers/server-trpc";
import { DataBrowserContent } from "./data-browser-content";

export default async function DataBrowserPage() {
  let dehydratedState: DehydratedState | undefined = undefined;
  try {
    const helpers = await createServerHelpers();
    await helpers.dataBrowser.listTables.prefetch().catch(() => undefined);
    dehydratedState = dehydrate(helpers.queryClient);
  } catch {
    dehydratedState = undefined;
  }

  return (
    <HydrationBoundary state={dehydratedState}>
      <DataBrowserContent />
    </HydrationBoundary>
  );
}
