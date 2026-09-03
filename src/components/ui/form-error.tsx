"use client";

/**
 * Inline form error display component.
 *
 * Usage:
 *   <FormError error={mutation.error} />
 *   <FormError message="Name is required" />
 *   <FormError error={mutation.error} prefix="Failed to save" />
 *
 * Renders nothing when there is no error. Extracts the user-facing message
 * from tRPC TRPCClientError objects automatically.
 */

type FormErrorProps = {
  /** A tRPC mutation `.error` value, a native Error, or null/undefined. */
  error?: { message: string } | null;
  /** A plain string message (takes precedence over `error` if both provided). */
  message?: string | null;
  /** Optional prefix prepended to the error message (e.g. "Failed to create item"). */
  prefix?: string;
  /** Additional CSS classes. */
  className?: string;
};

export function FormError({
  error,
  message,
  prefix,
  className,
}: FormErrorProps) {
  const text = message ?? error?.message ?? null;
  if (!text) return null;

  const display = prefix ? `${prefix}: ${text}` : text;

  return (
    <p role="alert" className={`mt-1 text-xs text-red-600 ${className ?? ""}`}>
      {display}
    </p>
  );
}

/**
 * Larger block-level form error, matching the onboarding wizard style.
 * Use for top-of-form or section-level errors.
 */
export function FormErrorBlock({
  error,
  message,
  prefix,
  className,
}: FormErrorProps) {
  const text = message ?? error?.message ?? null;
  if (!text) return null;

  const display = prefix ? `${prefix}: ${text}` : text;

  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${className ?? ""}`}
    >
      {display}
    </div>
  );
}
