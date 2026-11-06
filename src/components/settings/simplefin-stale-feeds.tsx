"use client";

/** A SimpleFIN institution still listed but whose balances stopped: the
 *  connection at SimpleFIN Bridge needs reconnecting. */
import { trpc } from "@/lib/trpc";
import { staleFeedMessages } from "@/lib/pure/sync/stale-feed-message";

/** One line per stale institution; only `institution`'s when given. */
export function StaleFeedNotes({ institution }: { institution?: string }) {
  const { data: status } = trpc.simplefin.getStatus.useQuery();
  return staleFeedMessages(status?.staleFeeds ?? [])
    .filter((m) => institution === undefined || m.institution === institution)
    .map((m) => (
      <p key={m.institution} className="text-amber-600">
        {m.message}
      </p>
    ));
}

/** An institution's heading in SimpleFIN settings, with its stale note. */
export function InstitutionHeading({ orgName }: { orgName: string }) {
  return (
    <div className="text-muted mb-1 text-xs font-medium">
      <p>{orgName || "Unknown institution"}</p>
      <StaleFeedNotes institution={orgName} />
    </div>
  );
}
