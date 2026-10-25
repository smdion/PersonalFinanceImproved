import Link from "next/link";
import type { ReactNode } from "react";
import { focusHref, type Focus } from "@/lib/config/focus-topics";
import { LINK_CLASS } from "@/components/ui/settings-link";

/** A link that lands on the data it's about (lib/config/focus-topics). */
export function FocusLink({
  focus,
  className = LINK_CLASS,
  title,
  children,
}: {
  focus: Focus;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link href={focusHref(focus)} className={className} title={title}>
      {children}
    </Link>
  );
}
