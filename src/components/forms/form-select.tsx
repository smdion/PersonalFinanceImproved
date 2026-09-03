import { forwardRef, type SelectHTMLAttributes } from "react";

type FormSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "className"
> & {
  className?: string;
};

/**
 * Styled select matching the existing form patterns.
 */
export const FormSelect = forwardRef<HTMLSelectElement, FormSelectProps>(
  function FormSelect({ className = "", children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`border-default bg-input-bg text-input-text w-full rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  },
);
