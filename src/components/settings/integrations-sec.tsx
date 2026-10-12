"use client";

/** Settings card for SEC fund facts — the contact SEC requires, and the weekly refresh. Same layout as TiingoCard. */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format";
import {
  ConnectionStatusLine,
  ConnectionResultMessage,
} from "./integrations/connection-card";

export function SecCard() {
  const utils = trpc.useUtils();
  const [contactEmail, setContactEmail] = useState("");
  const [showUpdate, setShowUpdate] = useState(false);

  const { data: status } = trpc.sec.getStatus.useQuery();
  const isConnected = status?.connected ?? false;
  const invalidate = () => {
    utils.sec.getStatus.invalidate();
    utils.investments.invalidate();
  };

  const saveMut = trpc.sec.saveContact.useMutation({
    onSuccess: () => {
      invalidate();
      setContactEmail("");
      setShowUpdate(false);
    },
  });
  const testMut = trpc.sec.testConnection.useMutation();
  const refreshMut = trpc.sec.refreshNow.useMutation({ onSuccess: invalidate });
  const removeMut = trpc.sec.removeConnection.useMutation({
    onSuccess: invalidate,
  });

  return (
    <Card title="SEC fund facts">
      <div className="space-y-4">
        <p className="text-muted text-xs">
          Expense ratios and what each fund holds, from the filings funds make
          with the{" "}
          <a
            href="https://www.sec.gov/search-filings/edgar-search-tools"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-primary underline"
          >
            SEC
          </a>
          . Free and official; checked weekly. SEC asks every app to identify
          itself with a contact email — it&apos;s sent only to sec.gov.
        </p>

        {isConnected && (
          <ConnectionStatusLine
            connected
            extra={
              status?.lastRun && (
                <span className="text-caption text-faint">
                  Last checked {formatRelativeTime(status.lastRun)}
                </span>
              )
            }
          />
        )}

        {isConnected && status && (
          <p className="text-caption text-muted">
            Facts for {status.fundsWithFacts}{" "}
            {status.fundsWithFacts === 1 ? "fund" : "funds"}
            {status.standInsToConfirm > 0 &&
              ` · ${status.standInsToConfirm} suggested stand-in${status.standInsToConfirm === 1 ? "" : "s"} to confirm on Benchmarks`}
            {status.fundsWithoutSource > 0 &&
              ` · ${status.fundsWithoutSource} without SEC filings (enter their facts on Benchmarks)`}
            .
          </p>
        )}
        {status?.lastError && (
          <ConnectionResultMessage tone="error">
            {status.lastError}
          </ConnectionResultMessage>
        )}

        {(!isConnected || showUpdate) && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="sec-contact"
                className="text-muted mb-1 block text-xs font-medium"
              >
                Contact email
              </label>
              <input
                id="sec-contact"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
                className="border-strong w-full rounded border px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => saveMut.mutate({ contactEmail })}
                disabled={!contactEmail || saveMut.isPending}
              >
                {saveMut.isPending ? "Checking..." : "Connect"}
              </Button>
              {showUpdate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowUpdate(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
            {saveMut.isError && (
              <ConnectionResultMessage tone="error">
                {saveMut.error.message}
              </ConnectionResultMessage>
            )}
          </div>
        )}

        {isConnected && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => testMut.mutate()}
              disabled={testMut.isPending}
            >
              {testMut.isPending ? "Testing..." : "Test"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
            >
              {refreshMut.isPending ? "Checking SEC..." : "Refresh now"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowUpdate(!showUpdate)}
            >
              {showUpdate ? "Hide" : "Change contact"}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (
                  confirm(
                    "Remove the SEC connection? Stored fund facts are kept.",
                  )
                )
                  removeMut.mutate();
              }}
              disabled={removeMut.isPending}
            >
              Remove
            </Button>
          </div>
        )}

        {testMut.isSuccess && testMut.data && (
          <ConnectionResultMessage
            tone={testMut.data.success ? "success" : "error"}
          >
            {testMut.data.success
              ? `Connected: SEC lists ${testMut.data.funds.toLocaleString()} fund share classes`
              : testMut.data.error}
          </ConnectionResultMessage>
        )}
        {refreshMut.isSuccess && refreshMut.data && (
          <ConnectionResultMessage
            tone={refreshMut.data.stoppedBySec ? "error" : "success"}
          >
            {refreshMut.data.stoppedBySec
              ? "SEC asked us to slow down — stopped; stored facts are kept."
              : `Checked ${refreshMut.data.checked} funds · ${refreshMut.data.updated} new facts`}
          </ConnectionResultMessage>
        )}
        {refreshMut.isError && (
          <ConnectionResultMessage tone="error">
            {refreshMut.error.message}
          </ConnectionResultMessage>
        )}
      </div>
    </Card>
  );
}
