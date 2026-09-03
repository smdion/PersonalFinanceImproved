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
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-primary text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle && <div className="text-muted mt-1 text-sm">{subtitle}</div>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
