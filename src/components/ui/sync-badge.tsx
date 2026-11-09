import { budgetApiServiceLabel } from "@/lib/config/display-labels";
import { Badge } from "./badge";

/** Small pill indicating a value was synced from an external budget API — always the one actually connected. */
export function SyncBadge({ source }: { source: string }) {
  return (
    <Badge color="blue" size="sm" case="normal" className="ml-1.5">
      Synced from {budgetApiServiceLabel(source)}
    </Badge>
  );
}
