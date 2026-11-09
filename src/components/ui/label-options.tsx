/** A picker's options from a label table: each key with its label, in the
 *  table's order. */
export function LabelOptions({
  labels,
}: {
  labels: Readonly<Record<string, string>>;
}) {
  return Object.entries(labels).map(([value, label]) => (
    <option key={value} value={value}>
      {label}
    </option>
  ));
}
