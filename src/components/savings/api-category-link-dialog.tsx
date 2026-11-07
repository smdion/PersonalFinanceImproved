"use client";

import React from "react";

export interface ApiCategoryGroup {
  id: string;
  name: string;
  categories: { id: string; name: string }[];
}

/** Savings: pick the budget-API category a goal links to. */
export function ApiCategoryLinkDialog({
  groups,
  onLink,
  onClose,
}: {
  groups: ApiCategoryGroup[];
  onLink: (
    group: ApiCategoryGroup,
    category: ApiCategoryGroup["categories"][number],
  ) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface-primary max-h-96 w-80 overflow-y-auto rounded-lg p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-secondary text-sm font-semibold">
            Link to API Category
          </h3>
          <button
            onClick={onClose}
            className="text-faint hover:text-muted text-xs"
          >
            Close
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="text-faint py-4 text-center text-xs">
            No categories. Sync budget API first.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="mb-2">
              <div className="text-caption text-muted px-1 py-0.5 font-semibold tracking-wider uppercase">
                {group.name}
              </div>
              {group.categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => onLink(group, cat)}
                  className="text-secondary w-full rounded px-2 py-1 text-left text-xs hover:bg-blue-50"
                >
                  {cat.name}
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
