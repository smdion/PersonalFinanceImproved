"use client";

import React from "react";

export function CategoryTabs({
  categories,
  activeCategory,
  onCategoryChange,
}: {
  categories: string[];
  activeCategory: string;
  onCategoryChange: (category: string) => void;
}) {
  return (
    <div className="flex gap-1 bg-surface-elevated rounded-lg p-1 mb-6 w-fit">
      {categories.map((cat) => (
        <button
          key={cat}
          onClick={() => onCategoryChange(cat)}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            activeCategory === cat
              ? "bg-surface-primary text-primary shadow-sm font-medium"
              : "text-muted hover:text-primary"
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
