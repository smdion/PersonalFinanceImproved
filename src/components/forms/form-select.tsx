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
        className={`w-full px-2 py-1 border border-default rounded bg-input-bg text-input-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  },
);
