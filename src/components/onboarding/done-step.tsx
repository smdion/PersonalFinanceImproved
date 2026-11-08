/** The first-run wizard's Done step. */

export function DoneStep({
  isSaving,
  taxDataSync,
  setTaxDataSync,
}: {
  isSaving: boolean;
  taxDataSync: boolean;
  setTaxDataSync: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="text-primary text-4xl font-bold">
        You&apos;re all set!
      </div>
      <p className="text-muted max-w-md text-lg">
        Your dashboard is ready. You can always add more details from the
        Settings page.
      </p>
      <label className="text-secondary flex max-w-md items-start gap-2 text-left text-sm">
        <input
          type="checkbox"
          checked={taxDataSync}
          onChange={(e) => setTaxDataSync(e.target.checked)}
          className="mt-1"
        />
        <span>
          Check weekly for new tax figures (IRS limits, brackets) between Ledgr
          updates. A plain request to the project&apos;s GitHub — nothing about
          you is sent, and nothing changes until you review it. You can turn it
          off later under Integrations.
        </span>
      </label>
      {isSaving && <p className="text-muted text-sm">Saving your data...</p>}
    </div>
  );
}
