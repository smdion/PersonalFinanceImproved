import type { ReactNode } from "react";

/**
 * Shared page header with consistent styling.
 * Use `subtitle` for descriptive text, `children` for action buttons/selectors.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-primary">{title}</h1>
        {subtitle && <div className="text-sm text-muted mt-1">{subtitle}</div>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
