"use client";

/**
 * Settings card for community tax-data updates (lib/tax-data/sync.ts):
 * on/off, the last weekly check and Check now. An update it finds is
 * reviewed in Reference Data, never applied from here.
 */
import React from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useUser, isAdmin } from "@/lib/context/user-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format";
import {
  ConnectionStatusLine,
  ConnectionResultMessage,
} from "./integrations/connection-card";

/** The last check's result in words. */
const RESULT: Record<string, string> = {
  off: "Off",
  current: "Tax data is up to date",
  pending: "An update is waiting for review",
  applied: "A newer release changed nothing here",
  "needs-newer-ledgr": "A newer release needs a newer Ledgr",
  invalid: "A newer release failed its checks and wasn't offered",
  "rate-limited": "GitHub asked to slow down — trying again tomorrow",
  error: "The check failed — trying again tomorrow",
};

export function TaxDataSyncCard() {
  const admin = isAdmin(useUser());
  const utils = trpc.useUtils();
  const { data: status } = trpc.settings.taxDataSync.status.useQuery();
  const invalidate = () => utils.settings.taxDataSync.invalidate();
  const setEnabled = trpc.settings.taxDataSync.setEnabled.useMutation({
    onSuccess: invalidate,
  });
  const checkNow = trpc.settings.taxDataSync.checkNow.useMutation({
    onSuccess: invalidate,
  });
  const last = status?.lastCheck;

  return (
    <Card title="Tax data updates">
      <div className="space-y-4">
        <p className="text-muted text-xs">
          New tax figures (IRS limits, brackets, Medicare and poverty levels)
          reach Ledgr with each update. Turn this on to also get them in
          between: once a week Ledgr checks the project&apos;s signed tax-data
          release on GitHub. Nothing about your household is sent, and nothing
          changes until an admin reviews the update in{" "}
          <Link
            href="/settings?tab=taxdata&section=limits"
            className="hover:text-primary underline"
          >
            Reference Data
          </Link>
          . Figures you&apos;ve changed are never touched.
        </p>

        <ConnectionStatusLine
          connected={status?.enabled ?? false}
          labels={["On", "Off"]}
          extra={
            last && (
              <span className="text-caption text-faint">
                Last checked {formatRelativeTime(last.at)}
              </span>
            )
          }
        />

        {status?.offReason === "operator" && (
          <p className="text-caption text-muted">
            Turned off for this server (LEDGR_TAX_DATA_SYNC=off).
          </p>
        )}
        {status?.enabled && !status.cronConfigured && (
          <ConnectionResultMessage tone="error">
            CRON_SECRET isn&apos;t set, so the weekly check never runs — use
            Check now, or set it.
          </ConnectionResultMessage>
        )}
        {last && last.result !== "off" && (
          <p className="text-caption text-muted">
            {RESULT[last.result] ?? last.result}
            {last.detail && last.result !== "current"
              ? ` — ${last.detail}`
              : ""}
            .
          </p>
        )}
        {status?.pending && (
          <p className="text-caption">
            <Link
              href="/settings?tab=taxdata&section=limits"
              className="text-blue-600 hover:underline"
            >
              Review the waiting update
            </Link>
          </p>
        )}

        {admin &&
          status?.offReason !== "operator" &&
          status?.offReason !== "demo" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={status?.enabled ? "ghost" : "primary"}
                size="sm"
                onClick={() => setEnabled.mutate({ enabled: !status?.enabled })}
                disabled={setEnabled.isPending}
              >
                {status?.enabled ? "Turn off" : "Turn on"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => checkNow.mutate()}
                disabled={checkNow.isPending}
              >
                {checkNow.isPending ? "Checking..." : "Check now"}
              </Button>
            </div>
          )}
        {checkNow.isError && (
          <ConnectionResultMessage tone="error">
            {checkNow.error.message}
          </ConnectionResultMessage>
        )}
      </div>
    </Card>
  );
}
