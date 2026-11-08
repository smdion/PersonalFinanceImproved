/** A methodology reference table's heading row, one column per header. */
export function MethodologyTableHead({ headers }: { headers: string[] }) {
  return (
    <thead>
      <tr className="border-b text-left">
        {headers.map((h, i) => (
          <th
            key={h}
            className={i < headers.length - 1 ? "py-1.5 pr-3" : "py-1.5"}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}
