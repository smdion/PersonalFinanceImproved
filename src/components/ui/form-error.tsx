"use client";

/**
 * Inline form error display component.
 *
 * Usage:
 *   <FormError error={mutation.error} />
 *   <FormError message="Name is required" />
 *   <FormError error={mutation.error} prefix="Failed to save" />
 *
 * Renders nothing when there is no error. Shows a tRPC error's
 * `data.userMessage` when a service failed (errorText), else its message.
 */

import { errorText } from "@/lib/utils/mutation-error";

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
  const text = message ?? (error ? errorText(error) : null);
  if (!text) return null;

  const display = prefix ? `${prefix}: ${text}` : text;

  return (
    <p role="alert" className={`mt-1 text-xs text-red-600 ${className ?? ""}`}>
      {display}
    </p>
  );
}
