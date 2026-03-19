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
      <td className={`text-right px-4 py-3 ${className}`}>
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onBlur={onSaveEdit}
          onKeyDown={onKeyDown}
          className="w-24 text-right text-sm border border-blue-400 rounded px-2 py-0.5 bg-surface-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </td>
    );
  }

  return (
    <td
      className={`text-right px-4 py-3 cursor-pointer hover:bg-blue-50 rounded transition-colors ${className}`}
      onClick={onStartEdit}
      title="Click to edit"
    >
      {formatter(value)}
      {annotation}
    </td>
  );
}
