"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { formatPercent } from "@/lib/utils/format";

type CardProps = {
  title?: ReactNode;
  subtitle?: string;
  children: ReactNode;
  href?: string;
  className?: string;
  /** Content rendered on the right side of the card header (e.g. toggle buttons). */
  headerRight?: ReactNode;
  /** When true, card body can be toggled open/closed by clicking the title. */
  isCollapsible?: boolean;
  /** Initial open state when collapsible. Defaults to true. */
  isDefaultOpen?: boolean;
  /** Force the hover-lift/shadow treatment on even without href/isCollapsible
   * — for cards with some other real interactive behavior (e.g. an onClick
   * handler on content inside). Without href/isCollapsible/interactive, the
   * card gets no hover chrome, since there's nothing to click. */
  interactive?: boolean;
};

export function Card({
  title,
  subtitle,
  children,
  href,
  className = "",
  headerRight,
  isCollapsible = false,
  isDefaultOpen = true,
  interactive = false,
}: CardProps) {
  const [isOpen, setIsOpen] = useState(isDefaultOpen);
  const isInteractive = !!href || isCollapsible || interactive;
  const sharedClassName = `bg-surface-primary rounded-lg border border-default p-3 sm:p-4 shadow-sm transition-all duration-200 ${isInteractive ? "hover:shadow-md hover:-translate-y-[1px]" : ""} ${className}`;

  const content = (
    <>
      {title && (
        <div
          className={`flex items-start justify-between ${isOpen ? "mb-3" : ""} ${isCollapsible ? "cursor-pointer select-none" : ""}`}
          onClick={isCollapsible ? () => setIsOpen((prev) => !prev) : undefined}
          role={isCollapsible ? "button" : undefined}
          aria-expanded={isCollapsible ? isOpen : undefined}
          tabIndex={isCollapsible ? 0 : undefined}
          onKeyDown={
            isCollapsible
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsOpen((prev) => !prev);
                  }
                }
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            {isCollapsible && (
              <svg
                className={`w-4 h-4 text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
            <div>
              <h3 className="text-sm font-medium text-muted tracking-wide">
                {title}
              </h3>
              {subtitle && (
                <p className="text-xs text-faint mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {headerRight && (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {headerRight}
            </div>
          )}
        </div>
      )}
      {isOpen && children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={sharedClassName}>
        {content}
      </Link>
    );
  }
  return <div className={sharedClassName}>{content}</div>;
}

type MetricProps = {
  value: string;
  label?: string;
  trend?: { value: string; isPositive: boolean } | null;
};

export function Metric({ value, label, trend }: MetricProps) {
  return (
    <div>
      <p className="text-2xl font-semibold text-primary">{value}</p>
      {label && <p className="text-sm text-muted mt-1">{label}</p>}
      {trend && (
        <p
          className={`text-sm mt-1 ${trend.isPositive ? "text-green-600" : "text-red-600"}`}
        >
          {trend.isPositive ? "↑" : "↓"} {trend.value}
        </p>
      )}
    </div>
  );
}

const PROGRESS_BAR_VARIANT_COLORS = {
  default: "bg-blue-600",
  info: "bg-indigo-600",
  success: "bg-green-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
} as const;

type ProgressBarProps = {
  value: number; // 0–1
  label?: ReactNode;
  variant?: keyof typeof PROGRESS_BAR_VARIANT_COLORS;
  tooltip?: string;
};

export function ProgressBar({
  value,
  label,
  variant = "default",
  tooltip,
}: ProgressBarProps) {
  const color = PROGRESS_BAR_VARIANT_COLORS[variant];
  const percent = Math.min(100, Math.max(0, value * 100));
  const defaultTooltip = `${formatPercent(percent / 100)} progress`;
  return (
    <div title={tooltip ?? defaultTooltip}>
      <div className="flex justify-between text-sm mb-1">
        {label && <span className="text-secondary">{label}</span>}
        <span className="text-muted font-medium">
          {formatPercent(percent / 100)}
        </span>
      </div>
      <div className="h-2 sm:h-3 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
