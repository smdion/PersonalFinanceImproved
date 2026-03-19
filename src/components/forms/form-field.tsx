import type { ReactNode } from "react";

type FormFieldProps = {
  /** Field label text. */
  label: string;
  /** Optional help text below the input. */
  help?: string;
  /** Error message — renders in red below the input. */
  error?: string | null;
  /** The input/select/textarea element. */
  children: ReactNode;
  /** Additional classes on the wrapper. */
  className?: string;
};

/**
 * Form field wrapper: label + input + optional help text + optional error.
 *
 * Standardizes the label → input → error layout used across settings pages.
 *
 * @example
 * <FormField label="Name" error={errors.name}>
 *   <FormInput value={name} onChange={setName} />
 * </FormField>
 */
export function FormField({
  label,
  help,
  error,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <label className={`flex flex-col text-sm ${className}`}>
      <span className="font-medium text-secondary">{label}</span>
      <div className="mt-1">{children}</div>
      {help && !error && (
        <span className="text-xs text-faint mt-1">{help}</span>
      )}
      {error && (
        <span role="alert" className="text-xs text-red-600 mt-1">
          {error}
        </span>
      )}
    </label>
  );
}
