"use client";

/** Quick search (Cmd/Ctrl-K): jump to any page by name or by what's on it. */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { navStructure } from "@/components/layout/sidebar";
import { SEARCH_KEYWORDS } from "@/lib/config/search-keywords";
import { searchPages, type SearchEntry } from "@/lib/pure/quick-search";

function buildEntries(): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const entry of navStructure) {
    const items = "items" in entry ? entry.items : [entry];
    const group = "items" in entry ? entry.label : null;
    for (const item of items)
      out.push({
        href: item.href,
        label: item.label,
        group,
        keywords: SEARCH_KEYWORDS[item.href.split("?")[0]!] ?? [],
      });
  }
  return out;
}

/** The pages never change at runtime — built once. */
const ENTRIES = buildEntries();

export function QuickSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was before opening, to hand it back on close.
  const returnFocus = useRef<HTMLElement | null>(null);
  const results = searchPages(ENTRIES, query);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setActive(0);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus();
    } else {
      returnFocus.current?.focus?.();
      returnFocus.current = null;
    }
  }, [open]);

  if (!open) return null;
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        className="bg-surface-primary border-default w-full max-w-md rounded-lg border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-label="Search pages"
          aria-expanded="true"
          aria-controls="quick-search-results"
          aria-activedescendant={
            results[active] ? `quick-search-option-${active}` : undefined
          }
          placeholder="Search pages — try “HSA limit” or “FI”"
          className="border-subtle bg-surface-primary w-full rounded-t-lg border-b px-3 py-2 text-sm outline-none"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              go(results[active]!.href);
            }
          }}
        />
        {results.length === 0 && (
          <p className="text-muted px-3 py-2 text-sm" role="status">
            No matching page
          </p>
        )}
        {/* Keyboard moves through the options from the input
            (aria-activedescendant); a click picks one directly. */}
        <ul
          id="quick-search-results"
          role="listbox"
          aria-label="Pages"
          className="max-h-80 overflow-auto py-1"
        >
          {results.map((r, i) => (
            <li
              key={r.href}
              id={`quick-search-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={`flex w-full cursor-pointer items-center justify-between px-3 py-1.5 text-left text-sm ${
                i === active
                  ? "bg-surface-sunken text-primary"
                  : "text-secondary"
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.href)}
            >
              <span>{r.label}</span>
              {r.group && (
                <span className="text-caption text-faint">{r.group}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-micro text-faint border-subtle border-t px-3 py-1">
          ↑↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
