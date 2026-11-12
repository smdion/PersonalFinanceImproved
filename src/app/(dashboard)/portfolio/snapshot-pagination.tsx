import type { RouterOutputs } from "@/lib/trpc";
import type { Dispatch, SetStateAction } from "react";

export type SnapshotPaginationProps = {
  paginatedSnapshots: RouterOutputs["netWorth"]["listSnapshots"];
  setSnapshotPage: Dispatch<SetStateAction<number>>;
  showAll: boolean;
  snapshotPage: number;
};

/** The snapshot history's page controls, hidden when showing all. */
export function SnapshotPagination({
  paginatedSnapshots,
  setSnapshotPage,
  showAll,
  snapshotPage,
}: SnapshotPaginationProps) {
  return (
    <>
      {/* Pagination controls (hidden when showing all) */}
      {!showAll && paginatedSnapshots.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <button
            type="button"
            onClick={() => setSnapshotPage((p) => Math.max(1, p - 1))}
            disabled={snapshotPage <= 1}
            className="text-muted hover:text-primary border-strong rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <span className="text-muted text-sm">
            Page {paginatedSnapshots.page} of {paginatedSnapshots.totalPages}
          </span>
          <button
            type="button"
            onClick={() =>
              setSnapshotPage((p) =>
                Math.min(paginatedSnapshots.totalPages, p + 1),
              )
            }
            disabled={snapshotPage >= paginatedSnapshots.totalPages}
            className="text-muted hover:text-primary border-strong rounded border px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
