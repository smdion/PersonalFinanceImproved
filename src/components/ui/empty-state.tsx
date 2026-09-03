import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "./button";

type EmptyStateProps = {
  message: string;
  /** Suggested next step, rendered below the message. */
  hint?: ReactNode;
  /** Lucide icon component rendered above the message. */
  icon?: ReactNode;
  /** Primary action button. */
  action?: { label: string; onClick: () => void };
  /** Link to a settings page or related section. */
  link?: { label: string; href: string };
};

/**
 * Consistent empty-state placeholder used when a page or section has no data.
 *
 * Basic usage:   <EmptyState message="No data." />
 * Enhanced:      <EmptyState icon={<Inbox />} message="No goals yet." action={{ label: "Add Goal", onClick: ... }} />
 */
export function EmptyState({
  message,
  hint,
  icon,
  action,
  link,
}: EmptyStateProps) {
  return (
    <div role="status" className="py-12 text-center">
      {icon && (
        <div className="text-faint mb-3 flex justify-center [&>svg]:h-10 [&>svg]:w-10">
          {icon}
        </div>
      )}
      <p className="text-muted">{message}</p>
      {hint && <p className="text-faint mt-2 text-sm">{hint}</p>}
      {(action || link) && (
        <div className="mt-4 flex items-center justify-center gap-3">
          {action && (
            <Button variant="primary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
          {link && (
            <Link
              href={link.href}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {link.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
