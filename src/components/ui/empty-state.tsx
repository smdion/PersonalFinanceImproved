import type { ReactNode } from "react";
import { Button } from "./button";

type EmptyStateProps = {
  message: string;
  /** Suggested next step, rendered below the message. */
  hint?: ReactNode;
  /** Lucide icon component rendered above the message. */
  icon?: ReactNode;
  /** Primary action button. */
  action?: { label: string; onClick: () => void };
};

/**
 * Consistent empty-state placeholder used when a page or section has no data.
 *
 * Basic usage:   <EmptyState message="No data." />
 * Enhanced:      <EmptyState icon={<Inbox />} message="No goals yet." action={{ label: "Add Goal", onClick: ... }} />
 */
export function EmptyState({ message, hint, icon, action }: EmptyStateProps) {
  return (
    <div role="status" className="py-12 text-center">
      {icon && (
        <div className="text-faint mb-3 flex justify-center [&>svg]:h-10 [&>svg]:w-10">
          {icon}
        </div>
      )}
      <p className="text-muted">{message}</p>
      {hint && <p className="text-faint mt-2 text-sm">{hint}</p>}
      {action && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <Button variant="primary" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        </div>
      )}
    </div>
  );
}
