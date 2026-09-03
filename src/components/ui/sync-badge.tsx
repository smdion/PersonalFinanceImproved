import { Badge } from "./badge";

/** Small pill indicating a value was synced from an external budget API (YNAB, Actual, etc). */
export function SyncBadge({ source }: { source: string }) {
  return (
    <Badge color="blue" size="sm" case="normal" className="ml-1.5">
      Synced from {source.toUpperCase()}
    </Badge>
  );
}
