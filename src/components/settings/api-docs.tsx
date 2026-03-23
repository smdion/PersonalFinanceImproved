"use client";

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import type { ApiEndpoint } from "@/lib/types/api-docs";
import type { SchemaField } from "@/lib/utils/zod-introspect";

// ── Badge configs (data-driven, no if-chains) ──

const AUTH_BADGE: Record<string, { label: string; className: string }> = {
  public: { label: "Public", className: "bg-surface-elevated text-secondary" },
  protected: { label: "Session", className: "bg-green-100 text-green-700" },
  admin: { label: "Admin", className: "bg-red-100 text-red-700" },
  scenario: { label: "Scenario", className: "bg-purple-100 text-purple-700" },
  portfolio: { label: "Portfolio", className: "bg-purple-100 text-purple-700" },
  performance: {
    label: "Performance",
    className: "bg-purple-100 text-purple-700",
  },
  budget: { label: "Budget", className: "bg-purple-100 text-purple-700" },
  savings: { label: "Savings", className: "bg-purple-100 text-purple-700" },
  brokerage: { label: "Brokerage", className: "bg-purple-100 text-purple-700" },
  snapshot: { label: "Snapshot", className: "bg-purple-100 text-purple-700" },
  unknown: { label: "Unknown", className: "bg-yellow-100 text-yellow-700" },
};

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  query: { label: "Query", className: "bg-blue-100 text-blue-700" },
  mutation: { label: "Mutation", className: "bg-orange-100 text-orange-700" },
};

const UNKNOWN_BADGE = {
  label: "Unknown",
  className: "bg-yellow-100 text-yellow-700",
};

function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${className}`}
    >
      {label}
    </span>
  );
}

// ── Schema field table ──

function SchemaTable({ fields }: { fields: SchemaField[] }) {
  if (fields.length === 0) {
    return (
      <p className="text-xs text-faint italic px-4 py-2">No input parameters</p>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted border-b border-subtle">
          <th className="px-4 py-1.5 font-medium">Field</th>
          <th className="px-4 py-1.5 font-medium">Type</th>
          <th className="px-4 py-1.5 font-medium">Required</th>
          <th className="px-4 py-1.5 font-medium">Default</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f: SchemaField, i: number) => (
          <tr key={i} className="border-b border-subtle">
            <td className="px-4 py-1.5 font-mono text-primary">{f.name}</td>
            <td className="px-4 py-1.5 font-mono text-muted">{f.type}</td>
            <td className="px-4 py-1.5">
              {f.required ? (
                <span className="text-red-500">required</span>
              ) : (
                <span className="text-faint">optional</span>
              )}
            </td>
            <td className="px-4 py-1.5 font-mono text-muted">
              {f.defaultValue !== undefined ? String(f.defaultValue) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Endpoint row ──

function EndpointRow({ endpoint }: { endpoint: ApiEndpoint }) {
  const [expanded, setExpanded] = useState(false);
  const authBadge = AUTH_BADGE[endpoint.auth] ?? UNKNOWN_BADGE;
  const typeBadge = TYPE_BADGE[endpoint.type] ?? UNKNOWN_BADGE;
  const hasInput = endpoint.input.length > 0;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-sunken transition-colors"
      >
        <span className="text-faint text-xs w-4">{expanded ? "▾" : "▸"}</span>
        <code className="text-sm font-mono text-primary flex-1 truncate">
          {endpoint.path}
        </code>
        <Badge {...typeBadge} />
        <Badge {...authBadge} />
        {hasInput && (
          <span className="text-xs text-faint">
            {endpoint.input.length} field
            {endpoint.input.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t border-subtle bg-surface-sunken/50">
          <SchemaTable fields={endpoint.input} />
        </div>
      )}
    </div>
  );
}

// ── Main component ──

export function ApiDocsSettings() {
  const {
    data: endpoints,
    isLoading,
    error,
  } = trpc.apiDocs.list.useQuery(undefined, {
    staleTime: Infinity,
  });

  const [search, setSearch] = useState("");
  const [routerFilter, setRouterFilter] = useState("all");
  const [authFilter, setAuthFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const routers = useMemo((): string[] => {
    if (!endpoints) return [];
    return Array.from(
      new Set(endpoints.map((e: ApiEndpoint) => e.router)),
    ).sort();
  }, [endpoints]);

  const authLevels = useMemo((): string[] => {
    if (!endpoints) return [];
    return Array.from(
      new Set(endpoints.map((e: ApiEndpoint) => e.auth)),
    ).sort();
  }, [endpoints]);

  const filtered = useMemo((): ApiEndpoint[] => {
    if (!endpoints) return [];
    return endpoints.filter((e: ApiEndpoint) => {
      if (search && !e.path.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (routerFilter !== "all" && e.router !== routerFilter) return false;
      if (authFilter !== "all" && e.auth !== authFilter) return false;
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      return true;
    });
  }, [endpoints, search, routerFilter, authFilter, typeFilter]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-10 bg-surface-elevated rounded" />
        <div className="h-10 bg-surface-elevated rounded" />
        <div className="h-10 bg-surface-elevated rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 text-sm">
        Failed to load API docs: {error.message}
      </div>
    );
  }

  if (!endpoints) return null;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search endpoints..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <select
          value={routerFilter}
          onChange={(e) => setRouterFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-strong rounded-lg bg-surface-primary"
        >
          <option value="all">All routers</option>
          {routers.map((r: string) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          value={authFilter}
          onChange={(e) => setAuthFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-strong rounded-lg bg-surface-primary"
        >
          <option value="all">All auth</option>
          {authLevels.map((a: string) => (
            <option key={a} value={a}>
              {(AUTH_BADGE[a] ?? UNKNOWN_BADGE).label}
            </option>
          ))}
        </select>
        <div className="flex rounded-lg border border-strong overflow-hidden">
          {(["all", "query", "mutation"] as const).map((val) => (
            <button
              key={val}
              onClick={() => setTypeFilter(val)}
              className={`px-3 py-2 text-xs font-medium ${
                typeFilter === val
                  ? "bg-surface-primary text-primary"
                  : "bg-surface-primary text-muted hover:bg-surface-sunken"
              }`}
            >
              {val === "all"
                ? "All"
                : val.charAt(0).toUpperCase() + val.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-sm text-muted">
        Showing {filtered.length} of {endpoints.length} endpoints
      </p>

      {/* Endpoint list */}
      <div className="space-y-2">
        {filtered.map((endpoint: ApiEndpoint) => (
          <EndpointRow key={endpoint.path} endpoint={endpoint} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-faint text-center py-8">
            No endpoints match your filters.
          </p>
        )}
      </div>
    </div>
  );
}
