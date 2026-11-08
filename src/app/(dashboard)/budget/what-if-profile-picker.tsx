/** Local picker for one profile axis. */
export function ProfilePicker({
  label,
  value,
  options,
  onChange,
  note,
}: {
  label: string;
  value: number | null;
  options: { id: number; name: string }[];
  onChange: (id: number) => void;
  note?: string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted text-xs">{label}:</span>
      <select
        className="bg-surface-primary rounded border px-2 py-1 text-xs"
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} profile`}
      >
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {note && (
        <span className="text-caption font-medium text-amber-600">{note}</span>
      )}
    </div>
  );
}
