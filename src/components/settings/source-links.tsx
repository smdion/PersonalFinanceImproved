"use client";

/** The documents a shipped tax figure cites — each a link when the tax
 *  data has one (its year's `sources`). */
export function SourceLinks({
  citations,
  label,
  className = "text-caption text-faint",
}: {
  citations: readonly { name: string; url: string | null }[];
  /** e.g. "Source:" before the list. */
  label?: string;
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <span className={className}>
      {label && `${label} `}
      {citations.map((c, i) => (
        <span key={c.name}>
          {i > 0 && "; "}
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary underline decoration-dotted"
              title={`Open ${c.name}`}
            >
              {c.name}
            </a>
          ) : (
            c.name
          )}
        </span>
      ))}
    </span>
  );
}
