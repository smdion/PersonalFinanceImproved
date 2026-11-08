"use client";

/**
 * Presentational pieces the integration cards share: the connected-status
 * line, a result message, and the single-secret form and last-synced line
 * of the SimpleFIN and Tiingo cards. Action sets differ and stay per card.
 */
import { STATUS_COLORS } from "@/lib/utils/colors";
import { Button } from "@/components/ui/button";

export function ConnectionStatusLine({
  connected,
  extra,
  labels = ["Connected", "Not connected"],
}: {
  connected: boolean;
  /** The status text when on / off (a setting rather than a connection). */
  labels?: [string, string];
  /** Follow-on content next to the status text — an "Active" Badge, a
   *  "Last synced ..." caption, etc. */
  extra?: React.ReactNode;
}) {
  const colors = connected ? STATUS_COLORS.green : STATUS_COLORS.red;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`}
      />
      <span className={`text-sm ${colors.text}`}>
        {connected ? labels[0] : labels[1]}
      </span>
      {extra}
    </div>
  );
}

export function ConnectionResultMessage({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: React.ReactNode;
}) {
  const colors = tone === "success" ? STATUS_COLORS.green : STATUS_COLORS.red;
  return <p className={`text-xs ${colors.text}`}>{children}</p>;
}

/** "Connected" with when the connection last synced, if it has. */
export function LastSyncedStatus({
  lastSyncedAt,
}: {
  lastSyncedAt: string | Date | null | undefined;
}) {
  return (
    <ConnectionStatusLine
      connected
      extra={
        lastSyncedAt && (
          <span className="text-caption text-faint">
            Last synced {new Date(lastSyncedAt).toLocaleString()}
          </span>
        )
      }
    />
  );
}

/** One secret (a token or key) entered to connect, with Connect and, while
 *  replacing a saved one, Cancel. */
export function SecretConnectForm({
  inputId,
  label,
  placeholder,
  value,
  onChange,
  onConnect,
  pending,
  showCancel,
  onCancel,
  errorMessage,
}: {
  inputId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onConnect: () => void;
  pending: boolean;
  showCancel: boolean;
  onCancel: () => void;
  errorMessage: string | null;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor={inputId}
          className="text-muted mb-1 block text-xs font-medium"
        >
          {label}
        </label>
        <input
          id={inputId}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="border-strong w-full rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onConnect}
          disabled={!value || pending}
        >
          {pending ? "Connecting..." : "Connect"}
        </Button>
        {showCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {errorMessage !== null && (
        <ConnectionResultMessage tone="error">
          {errorMessage}
        </ConnectionResultMessage>
      )}
    </div>
  );
}
