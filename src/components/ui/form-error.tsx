"use client";

/**
 * Inline form error, from `error` or `message` (optional `prefix`). Renders nothing without an
 * error; shows a tRPC error's `data.userMessage` when present (errorText), else its message.
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
