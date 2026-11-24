/** The notes for the snapshot rows of an account type this version doesn't
 *  know: both views leave their money out. */
export function TaxBucketsUnknownTypes({ notes }: { notes: string[] }) {
  return (
    notes.length > 0 && (
      <p className="text-caption rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
        {notes.join(" ")}
      </p>
    )
  );
}
