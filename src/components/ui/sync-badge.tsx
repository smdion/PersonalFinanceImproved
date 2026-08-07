/** Small pill indicating a value was synced from an external budget API (YNAB, Actual, etc). */
export function SyncBadge({ source }: { source: string }) {
  return (
    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-caption font-medium bg-blue-50 text-blue-600">
      Synced from {source.toUpperCase()}
    </span>
  );
}
