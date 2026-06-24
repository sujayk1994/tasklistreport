import { useMemo } from "react";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renders `text` with every case-insensitive occurrence of `query`
 * wrapped in a <mark>. Returns the plain text when `query` is empty.
 */
export function HighlightedText({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const parts = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [text];
    const re = new RegExp(`(${escapeRegExp(trimmed)})`, "gi");
    return text.split(re);
  }, [text, query]);

  const trimmedLower = query.trim().toLowerCase();
  if (!trimmedLower) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.toLowerCase() === trimmedLower ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-400/40 dark:text-amber-50"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}
