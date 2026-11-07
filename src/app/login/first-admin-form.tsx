"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import { friendlyMutationError } from "@/lib/utils/mutation-error";

const INPUT_CLASS =
  "border-default bg-input text-input-text placeholder:text-input-placeholder w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-[rgb(var(--c-focus-ring))] focus:outline-none";

/** The same rules createLocalAdmin's input enforces, checked before sending. */
function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 12) return "Password must be at least 12 characters.";
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password))
    return "Password must contain at least one uppercase letter and one digit.";
  if (password !== confirm) return "Passwords don't match.";
  return null;
}

/**
 * A fresh install's first admin: creates the local admin account, then
 * signs in with it. Shown only while the server's first-run state says an
 * admin is needed; the server refuses it otherwise.
 */
export function FirstAdminForm({
  callbackUrl,
  onError,
  onCreatedNotSignedIn,
}: {
  callbackUrl: string;
  onError: (message: string | null) => void;
  /** The account exists but signing in with it failed. */
  onCreatedNotSignedIn: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const createLocalAdmin = trpc.settings.createLocalAdmin.useMutation();

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    onError(problem);
    if (problem) return;
    setIsLoading(true);
    try {
      await createLocalAdmin.mutateAsync({ name, email, password });
    } catch (err) {
      onError(
        friendlyMutationError(err) ?? "Could not create the admin account.",
      );
      setIsLoading(false);
      return;
    }
    const result = await signIn("local-admin", {
      email,
      password,
      redirect: false, // signIn can still resolve undefined: result stays guarded
      callbackUrl,
    });
    if (result?.url && !result.error) {
      window.location.href = result.url;
      return;
    }
    onError("The admin account was created. Sign in with it below.");
    onCreatedNotSignedIn();
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    type: string,
    autoComplete: string,
  ) => (
    <div>
      <label
        htmlFor={id}
        className="text-secondary mb-1 block text-sm font-medium"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        required
        autoComplete={autoComplete}
        className={INPUT_CLASS}
      />
    </div>
  );

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-4">
      <div>
        <h2 className="text-primary text-lg font-semibold">
          Create the first admin
        </h2>
        <p className="text-muted text-sm">
          This install has no admin yet. The account you create here signs in
          with email and password.
        </p>
      </div>
      {field("admin-name", "Name", name, setName, "text", "name")}
      {field("admin-email", "Email", email, setEmail, "email", "email")}
      {field(
        "admin-password",
        "Password",
        password,
        setPassword,
        "password",
        "new-password",
      )}
      {field(
        "admin-confirm",
        "Confirm password",
        confirm,
        setConfirm,
        "password",
        "new-password",
      )}
      <p className="text-muted text-xs">
        At least 12 characters, with an uppercase letter and a digit.
      </p>
      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {isLoading ? "Creating..." : "Create admin and sign in"}
      </button>
    </form>
  );
}
