"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";

type CardProps = {
  title?: ReactNode;
  subtitle?: string;
  children: ReactNode;
  href?: string;
  className?: string;
  /** Content rendered on the right side of the card header (e.g. toggle buttons). */
  headerRight?: ReactNode;
  /** When true, card body can be toggled open/closed by clicking the title. */
  collapsible?: boolean;
  /** Initial open state when collapsible. Defaults to true. */
  defaultOpen?: boolean;
};

export function Card({
  title,
  subtitle,
  children,
  href,
  className = "",
  headerRight,
  collapsible = false,
  defaultOpen = true,
}: CardProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const sharedClassName = `bg-surface-primary rounded-lg border border-default p-3 sm:p-4 shadow-sm hover:shadow-md hover:-translate-y-[1px] transition-all duration-200 ${className}`;

  const content = (
    <>
      {title && (
        <div
          className={`flex items-start justify-between ${isOpen ? "mb-3" : ""} ${collapsible ? "cursor-pointer select-none" : ""}`}
          onClick={collapsible ? () => setIsOpen((o) => !o) : undefined}
          role={collapsible ? "button" : undefined}
          aria-expanded={collapsible ? isOpen : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={
            collapsible
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsOpen((o) => !o);
                  }
                }
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            {collapsible && (
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
  trend?: { value: string; positive: boolean } | null;
};

export function Metric({ value, label, trend }: MetricProps) {
  return (
    <div>
      <p className="text-2xl font-semibold text-primary">{value}</p>
      {label && <p className="text-sm text-muted mt-1">{label}</p>}
      {trend && (
        <p
          className={`text-sm mt-1 ${trend.positive ? "text-green-600" : "text-red-600"}`}
        >
          {trend.positive ? "↑" : "↓"} {trend.value}
        </p>
      )}
    </div>
  );
}

type ProgressBarProps = {
  value: number; // 0–1
  label?: ReactNode;
  color?: string;
  tooltip?: string;
};

export function ProgressBar({
  value,
  label,
  color = "bg-blue-600",
  tooltip,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, value * 100));
  const defaultTooltip = `${pct.toFixed(0)}% progress`;
  return (
    <div title={tooltip ?? defaultTooltip}>
      <div className="flex justify-between text-sm mb-1">
        {label && <span className="text-secondary">{label}</span>}
        <span className="text-muted font-medium">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 sm:h-3 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
