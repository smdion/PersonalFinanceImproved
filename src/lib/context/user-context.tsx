"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/server/auth";

type UserContextValue = {
  name: string;
  role: "admin" | "viewer";
  permissions: Permission[];
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  user,
  children,
}: {
  user: UserContextValue;
  children: React.ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}

/** Admin has full access to all settings */
export function isAdmin(user: UserContextValue): boolean {
  return user.role === "admin";
}

/** Check if user has a specific permission (admin always passes) */
export function hasPermission(user: UserContextValue, p: Permission): boolean {
  return user.role === "admin" || user.permissions.includes(p);
}
