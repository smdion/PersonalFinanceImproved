import { useId, type ReactNode, isValidElement, cloneElement } from "react";

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
 * Automatically injects `aria-invalid` and `aria-describedby` on the child
 * input element when an error is present.
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
  const errorId = useId();
  const hasError = !!error;

  // Inject aria attributes onto the child input element when an error is present.
  // Preserves any existing aria-describedby on the child by appending the error ID.
  const enhancedChildren =
    hasError && isValidElement(children)
      ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          "aria-invalid": true,
          "aria-describedby": [
            (children.props as Record<string, unknown>)["aria-describedby"],
            errorId,
          ]
            .filter(Boolean)
            .join(" "),
        })
      : children;

  return (
    <label className={`flex flex-col text-sm ${className}`}>
      <span className="font-medium text-secondary">{label}</span>
      <div className="mt-1">{enhancedChildren}</div>
      {help && !error && (
        <span className="text-xs text-faint mt-1">{help}</span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-xs text-red-600 mt-1">
          {error}
        </span>
      )}
    </label>
  );
}
