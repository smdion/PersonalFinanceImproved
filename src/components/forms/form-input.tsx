import { forwardRef, type InputHTMLAttributes } from "react";

type FormInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className"
> & {
  /** Additional classes. */
  className?: string;
};

/**
 * Styled input matching the existing form patterns (px-2 py-1 border rounded).
 */
export const FormInput = forwardRef<HTMLInputElement, FormInputProps>(
  function FormInput({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`border-default bg-input-bg text-input-text placeholder:text-input-placeholder w-full rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500/50 focus:outline-none disabled:opacity-50 ${className}`}
        {...props}
      />
    );
  },
);
