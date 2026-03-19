"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

const variantStyles = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500/50",
  secondary:
    "bg-surface-elevated text-secondary border border-default hover:bg-surface-strong focus-visible:ring-2 focus-visible:ring-blue-500/50",
  ghost: "text-muted hover:text-primary hover:bg-surface-elevated",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500/50",
} as const;

const sizeStyles = {
  xs: "px-1.5 py-0.5 text-xs rounded",
  sm: "px-3 py-1 text-sm rounded",
  md: "px-3 py-1.5 text-sm rounded",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variantStyles;
  size?: keyof typeof sizeStyles;
  /** Icon rendered before the label. */
  icon?: ReactNode;
};

/**
 * Shared button component with consistent styling.
 *
 * Variants: primary (blue), secondary (outlined), ghost (text-only), danger (red).
 * Sizes: xs, sm, md.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      icon,
      className = "",
      children,
      disabled,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {icon}
        {children}
      </button>
    );
  },
);
