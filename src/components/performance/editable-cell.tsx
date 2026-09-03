"use client";

import React, { useRef, useEffect } from "react";
import type { EditableCellProps } from "./types";

export function EditableCell({
  value,
  formatter,
  isEditing,
  editValue,
  onStartEdit,
  onEditValueChange,
  onSaveEdit,
  onKeyDown,
  className = "",
  annotation,
}: EditableCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <td className={`px-4 py-3 text-right ${className}`}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onSaveEdit}
          onKeyDown={onKeyDown}
          className="bg-surface-primary w-24 rounded border border-blue-400 px-2 py-0.5 text-right text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
        />
      </td>
    );
  }

  return (
    <td
      className={`cursor-pointer rounded px-4 py-3 text-right whitespace-nowrap transition-colors hover:bg-blue-50 ${className}`}
      onClick={onStartEdit}
      title="Click to edit"
    >
      {formatter(value)}
      {annotation}
    </td>
  );
}
