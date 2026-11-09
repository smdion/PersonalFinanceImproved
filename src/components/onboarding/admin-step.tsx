/** The first-run wizard's Admin step: the local admin account. */
import { useState } from "react";
import { FormError } from "@/components/ui/form-error";
import type { AdminDraft } from "./wizard-state";

export function AdminStep({
  admin,
  setAdmin,
}: {
  admin: AdminDraft;
  setAdmin: (a: AdminDraft) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const validate = (field: string, value: string) => {
    const newErrors = { ...errors };
    if (field === "name" && !value.trim()) {
      newErrors.name = "Name is required";
    } else if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      newErrors.email = "Enter a valid email address";
    } else if (field === "password" && value.length < 12) {
      newErrors.password = "Password must be at least 12 characters";
    } else if (field === "confirmPassword" && value !== admin.password) {
      newErrors.confirmPassword = "Passwords do not match";
    } else {
      newErrors[field] = null;
    }
    setErrors(newErrors);
  };

  const update = (field: keyof AdminDraft, value: string) => {
    setAdmin({ ...admin, [field]: value });
    if (errors[field]) validate(field, value);
  };

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="text-center">
        <h2 className="text-primary text-2xl font-bold">
          Create Admin Account
        </h2>
        <p className="text-muted mt-1">
          Set up a local admin account for logging in. This is your primary
          login and recovery method.
        </p>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
        <div>
          <label className="text-secondary mb-1 block text-sm font-medium">
            Display Name
          </label>
          <input
            aria-label="Display Name"
            type="text"
            value={admin.name}
            onChange={(e) => update("name", e.target.value)}
            onBlur={(e) => validate("name", e.target.value)}
            placeholder="Admin"
            className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.name ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.name ?? null} />
        </div>
        <div>
          <label className="text-secondary mb-1 block text-sm font-medium">
            Email
          </label>
          <input
            aria-label="Email"
            type="email"
            value={admin.email}
            onChange={(e) => update("email", e.target.value)}
            onBlur={(e) => validate("email", e.target.value)}
            placeholder="admin@example.com"
            className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.email ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.email ?? null} />
        </div>
        <div>
          <label className="text-secondary mb-1 block text-sm font-medium">
            Password
          </label>
          <input
            aria-label="Password"
            type="password"
            value={admin.password}
            onChange={(e) => update("password", e.target.value)}
            onBlur={(e) => validate("password", e.target.value)}
            className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.password ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.password ?? null} />
          <p className="text-muted mt-1 text-xs">Minimum 12 characters</p>
        </div>
        <div>
          <label className="text-secondary mb-1 block text-sm font-medium">
            Confirm Password
          </label>
          <input
            aria-label="Confirm Password"
            type="password"
            value={admin.confirmPassword}
            onChange={(e) => update("confirmPassword", e.target.value)}
            onBlur={(e) => validate("confirmPassword", e.target.value)}
            className={`bg-surface-primary text-primary placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none ${errors.confirmPassword ? "border-red-400" : "border-default"}`}
          />
          <FormError message={errors.confirmPassword ?? null} />
        </div>
      </div>
    </div>
  );
}
