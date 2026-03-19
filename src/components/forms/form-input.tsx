import { forwardRef, type InputHTMLAttributes } from "react";

type FormInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className"> & {
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
        className={`w-full px-2 py-1 border border-default rounded bg-input-bg text-input-text placeholder:text-input-placeholder text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 ${className}`}
        {...props}
      />
    );
  },
);
